/**
 * 统一检索入口 — spec 4.5
 *
 * 查询理解 → 时间通道 + 条目语义通道 + 文档语义通道 → 加权合并。
 * 供调试接口 POST /api/search 与后续回答生成（阶段 7）共用。
 */

import { isMockMode } from '../rag/index.js'
import { logger } from '../logger.js'
import type { EntryType } from '../extract/extractor.js'
import { searchDocumentsSemantic } from './docChannel.js'
import { searchEntriesSemantic } from './entrySearch.js'
import { mergeSearchSignals, type SearchResultItem, type SearchSummary } from './merge.js'
import { rerankCandidates } from './rerank.js'
import {
  ruleBasedUnderstanding,
  understandQuery,
  type QueryUnderstanding,
  type TimeWindow,
} from './queryUnderstanding.js'
import { searchTimeChannel } from './timeChannel.js'

const ALL_TYPES: EntryType[] = ['schedule', 'plan', 'fact', 'note']

export interface SearchAllOptions {
  query: string
  libraryId?: string
  now?: number
  timezone?: string
  /** 调试/测试：显式指定窗口，跳过模型调用 */
  timeRange?: TimeWindow | null
  includeArchived?: boolean
  /** 不调用模型，直接用规则解析（省一次 LLM 调用） */
  skipUnderstanding?: boolean
}

export interface SearchAllOutcome {
  understanding: QueryUnderstanding
  window: TimeWindow | null
  results: SearchResultItem[]
  summary: SearchSummary | null
  channels: { time: number; entry: number; doc: number }
  /** embedding 处于 mock 降级时，语义排序不可信（spec 4.4.4） */
  embeddingMock: boolean
  /** 检索为空 → 生成阶段必须走"未找到"话术（spec 4.5.5） */
  empty: boolean
}

/** 严格的个人归属线索：只认「我/咱」与个人知识库相关词（不含时间词），用于无命中时回退通用问答 */
const OWNER_CUE_RE = /我|咱|安排|日程|进度|待办|提醒|记得|记录|计划/

export const searchAll = async (options: SearchAllOptions): Promise<SearchAllOutcome> => {
  const nowMs = options.now ?? Date.now()

  const rules = ruleBasedUnderstanding(options.query, nowMs)
  const understanding: QueryUnderstanding =
    options.timeRange !== undefined
      ? {
          needsPersonalContext: true,
          timeRange: options.timeRange,
          keywords: [],
          entityTypes: ALL_TYPES,
          source: 'rules',
        }
      : // 规则已能给出明确时间窗口（或判定为通用问题）时不再调模型，省一次 LLM 往返
        options.skipUnderstanding || rules.timeRange !== null || !rules.needsPersonalContext
        ? rules
        : await understandQuery({
            query: options.query,
            now: nowMs,
            timezone: options.timezone,
          })

  const window = understanding.timeRange
  const needsPersonal = understanding.needsPersonalContext

  // ── decide 节点（spec 2.5.3 轻量实验）：通用问题跳过文档通道 ──
  // 条件：needsPersonalContext=false && timeRange=null → 判定为通用知识问题
  // 跳过文档通道可节省一次 embedding + 向量查询 + BM25
  // 风险：「龚熙皓是谁」可能被误判为通用但答案在资料里 → 用 ENABLE_DECIDE_SKIP_DOC 开关控制
  // 验证标准：miss 用例命中率下降 ≤ 2% 时固化
  const enableDecideSkipDoc = process.env.ENABLE_DECIDE_SKIP_DOC === '1'
  const skipDocChannel = enableDecideSkipDoc && !needsPersonal && window === null

  // 文档通道默认始终跑一次（本地 BM25 + 向量，成本低）：
  // 「龚熙皓是谁」这类问法常被误判为通用问题，但答案就在刚上传的资料里；
  // 真正的通用问题会在下方「资料未命中」分支返回空。
  const [timeHits, entryHits, docHits] = await Promise.all([
    needsPersonal && window
      ? searchTimeChannel({
          windowStart: window.start,
          windowEnd: window.end,
          libraryId: options.libraryId,
          includeArchived: options.includeArchived,
          now: nowMs,
        })
      : Promise.resolve([]),
    needsPersonal
      ? searchEntriesSemantic({ query: options.query, libraryId: options.libraryId })
      : Promise.resolve([]),
    skipDocChannel
      ? Promise.resolve([])
      : searchDocumentsSemantic(options.query).catch((err: unknown) => {
          logger.warn('search.all', '文档语义通道失败，已跳过', {
            error: (err as Error).message,
          })
          return []
        }),
  ])

  // 模型判为通用问题、但确实命中了资料 → 按个人上下文回答（带引用）
  if (!needsPersonal && docHits.length === 0) {
    logger.info('search.all', '通用知识问题，资料未命中', { queryLength: options.query.length })
    return {
      understanding,
      window,
      results: [],
      summary: null,
      channels: { time: 0, entry: 0, doc: 0 },
      embeddingMock: isMockMode(),
      empty: true,
    }
  }

  const merged = mergeSearchSignals({ timeHits, entryHits, docHits })
  let results = merged.results
  const summary = merged.summary

  // ── rerank（spec 1.6）：merge 后 LLM 重排序 ──
  // ENABLE_RERANK=1 开启；失败自动 fallback 到 merge 原顺序
  if (process.env.ENABLE_RERANK === '1' && results.length > 1) {
    results = await rerankCandidates(options.query, results)
  }

  // 三个通道全空，且问题不含个人归属线索（寒暄 / 常识，如「您好」「今天天气怎么样」）
  // → 交回通用问答；否则会误回「你的记录里没有相关内容」，等于答不上话。
  const fallbackToGeneral =
    needsPersonal && results.length === 0 && !OWNER_CUE_RE.test(options.query)

  const resolved: QueryUnderstanding = fallbackToGeneral
    ? { ...understanding, needsPersonalContext: false }
    : needsPersonal
      ? understanding
      : { ...understanding, needsPersonalContext: true }

  logger.info('search.all', '检索完成', {
    needsPersonalContext: resolved.needsPersonalContext,
    understandingSource: understanding.source,
    hasWindow: window !== null,
    time: timeHits.length,
    entry: entryHits.length,
    doc: docHits.length,
    shown: results.length,
    remaining: summary?.remaining ?? 0,
  })

  return {
    understanding: resolved,
    window,
    results,
    summary,
    channels: { time: timeHits.length, entry: entryHits.length, doc: docHits.length },
    embeddingMock: isMockMode(),
    empty: results.length === 0,
  }
}
