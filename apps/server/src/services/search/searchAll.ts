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

  if (!understanding.needsPersonalContext) {
    logger.info('search.all', '通用知识问题，跳过个人检索', { queryLength: options.query.length })
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

  const [timeHits, entryHits, docHits] = await Promise.all([
    window
      ? searchTimeChannel({
          windowStart: window.start,
          windowEnd: window.end,
          libraryId: options.libraryId,
          includeArchived: options.includeArchived,
          now: nowMs,
        })
      : Promise.resolve([]),
    searchEntriesSemantic({ query: options.query, libraryId: options.libraryId }),
    searchDocumentsSemantic(options.query).catch((err: unknown) => {
      logger.warn('search.all', '文档语义通道失败，已跳过', {
        error: (err as Error).message,
      })
      return []
    }),
  ])

  const { results, summary } = mergeSearchSignals({ timeHits, entryHits, docHits })

  logger.info('search.all', '检索完成', {
    needsPersonalContext: understanding.needsPersonalContext,
    understandingSource: understanding.source,
    hasWindow: window !== null,
    time: timeHits.length,
    entry: entryHits.length,
    doc: docHits.length,
    shown: results.length,
    remaining: summary?.remaining ?? 0,
  })

  return {
    understanding,
    window,
    results,
    summary,
    channels: { time: timeHits.length, entry: entryHits.length, doc: docHits.length },
    embeddingMock: isMockMode(),
    empty: results.length === 0,
  }
}
