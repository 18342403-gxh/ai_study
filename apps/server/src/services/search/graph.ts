/**
 * 检索图 — spec 阶段 2（Task 2 / AC-3）
 *
 * 把原先 `searchAllInner` 的硬编码流程拆成显式节点：
 *
 *   understand → retrieve ─┬→ finalize（通用问题且资料全空，早退）
 *                          └→ merge ─┬→ rerank → finalize
 *                                    └→ finalize
 *
 * 纯重构：对外仍是 `searchAll(options)`，返回结构与旧实现逐字段一致。
 * `ENABLE_GRAPH_SEARCH` 默认关闭，关闭时走 `searchAll.ts` 的旧路径。
 */

import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

import { withSpan } from '../../observability/tracing.js'
import type { EntryType } from '../extract/extractor.js'
import { compileGraph, tracedNode } from '../graph/runtime.js'
import type { GraphNode } from '../graph/types.js'
import { isMockMode } from '../rag/index.js'
import { logger } from '../logger.js'
import { searchDocumentsSemantic, type DocChannelHit } from './docChannel.js'
import { searchEntriesSemantic, type EntrySearchHit } from './entrySearch.js'
import { mergeSearchSignals, type SearchResultItem, type SearchSummary } from './merge.js'
import {
  ruleBasedUnderstanding,
  understandQuery,
  type QueryUnderstanding,
  type TimeWindow,
} from './queryUnderstanding.js'
import { rerankCandidates } from './rerank.js'
import type { SearchAllOptions, SearchAllOutcome } from './searchAll.js'
import { searchTimeChannel, type TimeChannelHit } from './timeChannel.js'

/** 时间窗口缺省的实体类型（与旧实现一致） */
export const ALL_TYPES: EntryType[] = ['schedule', 'plan', 'fact', 'note']

/** 严格的个人归属线索：只认「我/咱」与个人知识库相关词（不含时间词），用于无命中时回退通用问答 */
export const OWNER_CUE_RE = /我|咱|安排|日程|进度|待办|提醒|记得|记录|计划/

const SearchState = Annotation.Root({
  options: Annotation<SearchAllOptions>(),
  nowMs: Annotation<number>(),
  understanding: Annotation<QueryUnderstanding>(),
  needsPersonal: Annotation<boolean>(),
  window: Annotation<TimeWindow | null>(),
  skipDocChannel: Annotation<boolean>(),
  timeHits: Annotation<TimeChannelHit[]>(),
  entryHits: Annotation<EntrySearchHit[]>(),
  docHits: Annotation<DocChannelHit[]>(),
  /** merge 产出，rerank 后会原地覆盖为最终顺序 */
  candidateResults: Annotation<SearchResultItem[]>(),
  summary: Annotation<SearchSummary | null>(),
  outcome: Annotation<SearchAllOutcome>(),
})

export type SearchGraphState = typeof SearchState.State

/** 通用问题且三个通道全空 → 直接 return 空结果，交给通用问答 */
export const shouldExitEarly = (
  state: Pick<SearchGraphState, 'needsPersonal' | 'docHits' | 'entryHits'>,
): boolean => !state.needsPersonal && state.docHits.length === 0 && state.entryHits.length === 0

/** 条件边：retrieve → finalize（早退）| merge */
export const routeAfterRetrieve = (
  state: Pick<SearchGraphState, 'needsPersonal' | 'docHits' | 'entryHits'>,
): 'merge' | 'finalize' => (shouldExitEarly(state) ? 'finalize' : 'merge')

/** rerank 判定纯函数：开关开启且候选 > 1 才重排 */
export const shouldRerank = (candidateCount: number, rerankEnabled: boolean): boolean =>
  rerankEnabled && candidateCount > 1

/** 条件边：merge → rerank（开关开启且候选 > 1）| finalize */
export const routeAfterMerge = (
  state: Pick<SearchGraphState, 'candidateResults'>,
): 'rerank' | 'finalize' =>
  shouldRerank(state.candidateResults.length, process.env.ENABLE_RERANK === '1')
    ? 'rerank'
    : 'finalize'

const understandNode: GraphNode<SearchGraphState> = async (state) => {
  const { options } = state
  const rules = ruleBasedUnderstanding(options.query, state.nowMs)
  const understanding: QueryUnderstanding =
    options.timeRange !== undefined
      ? {
          needsPersonalContext: true,
          timeRange: options.timeRange,
          keywords: [],
          entityTypes: ALL_TYPES,
          queryType: 'keyword',
          source: 'rules',
        }
      : // 规则已能给出明确时间窗口（或判定为通用问题）时不再调模型，省一次 LLM 往返
        options.skipUnderstanding || rules.timeRange !== null || !rules.needsPersonalContext
        ? rules
        : await understandQuery({
            query: options.query,
            now: state.nowMs,
            timezone: options.timezone,
          })

  return {
    understanding,
    needsPersonal: understanding.needsPersonalContext,
    window: understanding.timeRange,
  }
}

const retrieveNode: GraphNode<SearchGraphState> = async (state) => {
  const { options, understanding } = state
  const window = understanding.timeRange
  const needsPersonal = understanding.needsPersonalContext

  // ── decide 节点（spec 2.5.3 轻量实验）：通用问题跳过文档通道 ──
  // 条件：needsPersonalContext=false && timeRange=null → 判定为通用知识问题
  // 跳过文档通道可节省一次 embedding + 向量查询 + BM25
  // 风险：「龚熙皓是谁」可能被误判为通用但答案在资料里 → 用 ENABLE_DECIDE_SKIP_DOC 开关控制
  // 验证标准：miss 用例命中率下降 ≤ 2% 时固化
  const skipDocChannel =
    process.env.ENABLE_DECIDE_SKIP_DOC === '1' && !needsPersonal && window === null

  // 文档通道默认始终跑一次（本地 BM25 + 向量，成本低）：
  // 「龚熙皓是谁」这类问法常被误判为通用问题，但答案就在刚上传的资料里；
  // 真正的通用问题会在下方「资料未命中」分支返回空。
  const [timeHits, entryHits, docHits] = await Promise.all([
    needsPersonal && window
      ? withSpan('retrieval.time_channel', { 'app.window': `${window.start}~${window.end}` }, () =>
          searchTimeChannel({
            windowStart: window.start,
            windowEnd: window.end,
            libraryId: options.libraryId,
            includeArchived: options.includeArchived,
            now: state.nowMs,
          }),
        )
      : Promise.resolve([]),
    // 与文档通道一样始终检索：人名问答（如「龚熙皓是谁」）常被初判为通用问题，
    // 但对话录入的条目仍可能命中，不能在此时提前跳过。
    withSpan('retrieval.entry_channel', {}, () =>
      searchEntriesSemantic({ query: options.query, libraryId: options.libraryId }),
    ),
    skipDocChannel
      ? Promise.resolve([])
      : withSpan('retrieval.doc_channel', {}, () =>
          searchDocumentsSemantic(
            options.query,
            15,
            understanding.queryType,
            options.libraryId,
          ).catch((err: unknown) => {
            logger.warn('search.all', '文档语义通道失败，已跳过', {
              error: (err as Error).message,
            })
            return []
          }),
        ),
  ])

  return { skipDocChannel, timeHits, entryHits, docHits }
}

const mergeNode: GraphNode<SearchGraphState> = (state) => {
  const merged = mergeSearchSignals({
    timeHits: state.timeHits,
    entryHits: state.entryHits,
    docHits: state.docHits,
  })
  return { candidateResults: merged.results, summary: merged.summary }
}

const rerankNode: GraphNode<SearchGraphState> = async (state) =>
  // ── rerank（spec 1.6）：merge 后 LLM 重排序，失败自动 fallback 到原顺序 ──
  ({
    candidateResults: await withSpan(
      'retrieval.rerank',
      { 'app.candidate_count': state.candidateResults.length },
      () => rerankCandidates(state.options.query, state.candidateResults),
    ),
  })

const finalizeNode: GraphNode<SearchGraphState> = (state) => {
  const { options, understanding } = state
  const window = understanding.timeRange
  const needsPersonal = understanding.needsPersonalContext

  if (shouldExitEarly(state)) {
    logger.info('search.all', '通用知识问题，资料未命中', { queryLength: options.query.length })
    return {
      outcome: {
        understanding,
        window,
        results: [],
        summary: null,
        channels: { time: 0, entry: 0, doc: 0 },
        embeddingMock: isMockMode(),
        empty: true,
      },
    }
  }

  const results = state.candidateResults
  const summary = state.summary

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
    time: state.timeHits.length,
    entry: state.entryHits.length,
    doc: state.docHits.length,
    shown: results.length,
    remaining: summary?.remaining ?? 0,
  })

  return {
    outcome: {
      understanding: resolved,
      window,
      results,
      summary,
      channels: {
        time: state.timeHits.length,
        entry: state.entryHits.length,
        doc: state.docHits.length,
      },
      embeddingMock: isMockMode(),
      empty: results.length === 0,
    },
  }
}

const buildSearchGraph = () =>
  new StateGraph(SearchState)
    .addNode('understand', tracedNode<SearchGraphState>('search', 'understand', understandNode))
    .addNode('retrieve', tracedNode<SearchGraphState>('search', 'retrieve', retrieveNode))
    .addNode('merge', tracedNode<SearchGraphState>('search', 'merge', mergeNode))
    .addNode('rerank', tracedNode<SearchGraphState>('search', 'rerank', rerankNode))
    .addNode('finalize', tracedNode<SearchGraphState>('search', 'finalize', finalizeNode))
    .addEdge(START, 'understand')
    .addEdge('understand', 'retrieve')
    .addConditionalEdges('retrieve', routeAfterRetrieve, ['merge', 'finalize'])
    .addConditionalEdges('merge', routeAfterMerge, ['rerank', 'finalize'])
    .addEdge('rerank', 'finalize')
    .addEdge('finalize', END)

type CompiledSearchGraph = Awaited<ReturnType<typeof compileGraph>>

let compiled: Promise<CompiledSearchGraph> | null = null

/** 检索图只在服务端进程内编译一次；无中断/恢复需求，不注入检查点 */
const getSearchGraph = (): Promise<CompiledSearchGraph> => {
  if (!compiled) {
    compiled = compileGraph(buildSearchGraph(), { checkpointer: false }).catch((err: unknown) => {
      compiled = null
      throw err
    }) as Promise<CompiledSearchGraph>
  }
  return compiled
}

export const runSearchGraph = async (options: SearchAllOptions): Promise<SearchAllOutcome> => {
  const graph = await getSearchGraph()
  const state = await graph.invoke({
    options,
    nowMs: options.now ?? Date.now(),
  })
  return (state as SearchGraphState).outcome
}
