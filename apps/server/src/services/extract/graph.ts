/**
 * 抽取图 — spec 阶段 3（Task 3 / AC-4）
 *
 *   extract ─┬→ match → finish                       （cancel / delete / update 直接执行）
 *            ├→ finish                               （抽取失败，保留原文给旧逻辑落草稿）
 *            └→ buildCards ─┬→ finish               （没有卡片）
 *                           └→ confirm ⇄ commit      （每轮 resume 处理部分卡片）
 *
 * 与旧路径的关系：
 *   - `ENABLE_GRAPH_EXTRACT=1` 时 `POST /api/extract` 走本图；默认关闭走旧实现。
 *   - 关闭时行为与改造前一致（含 cancel/delete/update、失败落 draft）。
 *
 * 增量确认：`confirm` 以 interrupt 挂起并返回当前未处理卡片；前端每次 resume 提交若干
 * 卡片的动作（skip / merge / create），`commit` 落库后若仍有剩余卡片则再次中断。
 * 这样单条确认、批量确认、刷新后恢复都复用同一个 thread。
 */

import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
  Command,
} from '@langchain/langgraph'
import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { getDb, tables } from '../../db/index.js'
import { compileGraph, tracedNode } from '../graph/runtime.js'
import { extractThreadId, parseThreadId } from '../graph/thread.js'
import type { GraphNode } from '../graph/types.js'
import type { ChatMessage } from '../chain/model.js'
import { logger } from '../logger.js'
import { removeEntryEmbedding, syncEntryEmbedding } from '../search/entryIndex.js'
import type { Recurrence } from './recurrence.js'
import {
  buildEntryCards,
  pickRelated,
  rowTimeText,
  rowToExisting,
  type EntryCard,
} from './cards.js'
import {
  extractEntries,
  type EntryType,
  type ExtractedEntry,
  type ExtractOutcome,
  type PromptEntry,
} from './extractor.js'

type EntryRow = typeof tables.entries.$inferSelect
type ExtractedTarget = ExtractedEntry

/** 检查点里的草稿卡片带稳定 key，供 resume 精确对应 */
export interface DraftCard extends EntryCard {
  key: string
}

export interface ExtractCommitSummary {
  created: number
  merged: number
  skipped: number
}

export interface ResumeCardEdit {
  key: string
  action: 'skip' | 'merge' | 'create'
  entryId?: string
  payload: {
    type: EntryType
    title: string
    content: string
    startAt?: number | null
    endAt?: number | null
    recurrence?: Recurrence | null
    confidence?: number
  }
}

export interface ExtractResumePayload {
  cards: ResumeCardEdit[]
}

export interface ExtractGraphInput {
  text: string
  userId?: string
  sessionId: string | null
  libraryId: string
  nowMs: number
  timezone: string
  /** 测试注入：替换 LLM 调用 */
  invoke?: (messages: ChatMessage[]) => Promise<string>
}

/** 一次 invoke/resume 的统一返回（interrupted 时 cards 为剩余待确认卡片） */
export interface ExtractGraphOutcome {
  draftId: string
  threadId: string
  outcome: ExtractOutcome
  interrupted: boolean
  cards: DraftCard[]
  reply: string
  committed: ExtractCommitSummary
}

// ── 取消/删除/改期：把抽取目标匹配到已有记录（与旧路径同口径） ──

const keywords = (text: string): string[] =>
  text
    .replace(/[\s，。、,.!?！？；;:："'""''（）()【】[\]《》<>]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

const titleSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0
  if (a === b) return 1
  const setA = new Set(keywords(a))
  const setB = new Set(keywords(b))
  const inter = [...setA].filter((k) => setB.has(k)).length
  const union = new Set([...setA, ...setB]).size
  const kwScore = union === 0 ? 0 : inter / union
  const ca = new Set(a.split(''))
  const cb = new Set(b.split(''))
  const cInter = [...ca].filter((c) => cb.has(c)).length
  const cUnion = new Set([...ca, ...cb]).size
  const charScore = cUnion === 0 ? 0 : cInter / cUnion
  return Math.max(kwScore, charScore * 0.8)
}

const timeOverlap = (
  aStart: number | null,
  aEnd: number | null,
  bStart: number | null,
  bEnd: number | null,
): number => {
  if (!aStart || !bStart) return 0
  const aE = aEnd ?? aStart
  const bE = bEnd ?? bStart
  const overlap = Math.max(0, Math.min(aE, bE) - Math.max(aStart, bStart))
  const span = Math.max(1, Math.max(aE, bE) - Math.min(aStart, bStart))
  return overlap / span
}

const matchExistingEntries = (
  targets: ExtractedEntry[],
  rows: EntryRow[],
): Array<{ id: string; target: ExtractedTarget }> => {
  const matched = new Map<string, ExtractedTarget>()
  for (const target of targets) {
    let bestId: string | null = null
    let bestScore = 0
    for (const row of rows) {
      if (matched.has(row.id)) continue
      const ts =
        titleSimilarity(target.title, row.title) || titleSimilarity(target.title, row.content)
      const timeScore = timeOverlap(
        target.time?.start ?? null,
        target.time?.end ?? null,
        row.startAt ? row.startAt.getTime() : null,
        row.endAt ? row.endAt.getTime() : null,
      )
      const typeBonus = target.type === row.type ? 0.1 : 0
      const score = ts * 0.6 + timeScore * 0.3 + typeBonus
      if (score > bestScore) {
        bestScore = score
        bestId = row.id
      }
    }
    if (bestId && bestScore >= 0.35) matched.set(bestId, target)
  }
  return [...matched].map(([id, target]) => ({ id, target }))
}

// ── 图状态 ───────────────────────────────────────────

const ExtractState = Annotation.Root({
  text: Annotation<string>(),
  sessionId: Annotation<string | null>(),
  userId: Annotation<string>(),
  libraryId: Annotation<string>(),
  nowMs: Annotation<number>(),
  timezone: Annotation<string>(),
  outcome: Annotation<ExtractOutcome>(),
  /** 待确认卡片（resume 后只剩未处理部分） */
  pendingCards: Annotation<DraftCard[]>(),
  draftId: Annotation<string>(),
  resume: Annotation<ExtractResumePayload | null>(),
  reply: Annotation<string>(),
  committed: Annotation<ExtractCommitSummary>(),
})

export type ExtractGraphState = typeof ExtractState.State

const EMPTY_COMMIT: ExtractCommitSummary = { created: 0, merged: 0, skipped: 0 }

/** 条件边：extract → match | buildCards | finish */
export const routeAfterExtract = (
  state: Pick<ExtractGraphState, 'outcome'>,
): 'match' | 'buildCards' | 'finish' => {
  const { intent, failed } = state.outcome
  if (intent === 'cancel' || intent === 'delete' || intent === 'update') return 'match'
  if (failed !== null) return 'finish'
  return 'buildCards'
}

/** 条件边：buildCards / commit → confirm | finish */
export const routeAfterCards = (
  state: Pick<ExtractGraphState, 'pendingCards'>,
): 'confirm' | 'finish' => (state.pendingCards.length > 0 ? 'confirm' : 'finish')

/** 条件边：START → extract（对话抽取） | confirm（文档抽取已带卡片） */
export const routeAtStart = (
  state: Pick<ExtractGraphState, 'pendingCards'>,
): 'extract' | 'confirm' =>
  state.pendingCards && state.pendingCards.length > 0 ? 'confirm' : 'extract'

const toDate = (ms: number | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(ms)

const loadActiveRows = async (libraryId: string): Promise<EntryRow[]> => {
  const db = getDb()
  return db
    .select()
    .from(tables.entries)
    .where(and(eq(tables.entries.libraryId, libraryId), eq(tables.entries.status, 'active')))
    .orderBy(desc(tables.entries.updatedAt))
    .limit(50)
}

const createExtractNode =
  (invoke?: (messages: ChatMessage[]) => Promise<string>): GraphNode<ExtractGraphState> =>
  async (state) => {
    const rows = await loadActiveRows(state.libraryId)
    const related = pickRelated(state.text, rows)
    const promptEntries: PromptEntry[] = related.map((row) => ({
      type: row.type,
      title: row.title,
      content: row.content,
      timeText: rowTimeText(row),
    }))

    const outcome = await extractEntries({
      text: state.text,
      now: state.nowMs,
      timezone: state.timezone,
      existingEntries: promptEntries,
      invoke,
    })
    return { outcome }
  }

/** 取消 / 删除 / 改期：直接操作已有记录并结束 */
const matchNode: GraphNode<ExtractGraphState> = async (state) => {
  const db = getDb()
  const rows = await loadActiveRows(state.libraryId)
  const matched = matchExistingEntries(state.outcome.entries, rows)
  const now = new Date(state.nowMs)
  let affected = 0

  for (const { id, target } of matched) {
    if (state.outcome.intent === 'cancel') {
      await db
        .update(tables.entries)
        .set({ status: 'archived', archivedAt: now, updatedAt: now })
        .where(eq(tables.entries.id, id))
      affected++
    } else if (state.outcome.intent === 'delete') {
      await removeEntryEmbedding(id)
      await db.delete(tables.entries).where(eq(tables.entries.id, id))
      affected++
    } else {
      const row = rows.find((r) => r.id === id)
      const newStart = target.time?.start
      const newTitle = target.updates?.title
      const newContent = target.updates?.content
      const patch: {
        startAt?: Date | null
        endAt?: Date | null
        title?: string
        content?: string
        updatedAt: Date
      } = { updatedAt: now }
      let changed = false
      const hasFieldUpdates = Boolean(newTitle || newContent)
      if (!hasFieldUpdates && newStart && newStart !== row?.startAt?.getTime()) {
        const previousStart = row?.startAt?.getTime()
        const previousEnd = row?.endAt?.getTime()
        const duration =
          previousStart !== null &&
          previousStart !== undefined &&
          previousEnd !== null &&
          previousEnd !== undefined
            ? previousEnd - previousStart
            : null
        patch.startAt = new Date(newStart)
        patch.endAt = target.time?.end
          ? new Date(target.time.end)
          : duration !== null
            ? new Date(newStart + duration)
            : null
        changed = true
      }
      if (newTitle && newTitle !== row?.title) {
        patch.title = newTitle
        changed = true
      }
      if (newContent && newContent !== row?.content) {
        patch.content = newContent
        changed = true
      }
      if (!changed) continue
      await db.update(tables.entries).set(patch).where(eq(tables.entries.id, id))
      if (row && (newTitle || newContent)) {
        await syncEntryEmbedding(id, newTitle ?? row.title, newContent ?? row.content)
      }
      affected++
    }
  }

  const actionText =
    state.outcome.intent === 'cancel'
      ? '已取消'
      : state.outcome.intent === 'delete'
        ? '已删除'
        : '已更新'
  const reply =
    affected > 0
      ? `${actionText} ${affected} 条记录。`
      : state.outcome.intent === 'update'
        ? '没有找到对应的记录，或没能识别出要修改的内容。'
        : '没有找到对应的记录，可能已被处理或不存在。'

  logger.info('extract.graph', `${state.outcome.intent} 操作完成`, {
    libraryId: state.libraryId,
    matchedIds: matched.map((m) => m.id),
    affected,
  })

  return { reply }
}

const buildCardsNode: GraphNode<ExtractGraphState> = async (state) => {
  const rows = await loadActiveRows(state.libraryId)
  const cards = await buildEntryCards(
    state.outcome.entries,
    rows.map(rowToExisting),
    state.nowMs,
    state.timezone,
  )
  return {
    pendingCards: cards.map((card, index) => ({ ...card, key: `${index}-${card.title}` })),
  }
}

/** 中断点：把待确认卡片交给调用方，resume 时拿回用户的处理动作 */
const confirmNode: GraphNode<ExtractGraphState> = (state) => {
  const resume = interrupt<
    { type: string; data: { draftId: string; cards: DraftCard[] } },
    ExtractResumePayload | undefined
  >({
    type: 'extract:confirm',
    data: { draftId: state.draftId, cards: state.pendingCards },
  })
  return { resume: resume ?? null }
}

/** 把 resume 里的卡片动作落库，并从待确认列表中移除 */
const commitNode: GraphNode<ExtractGraphState> = async (state) => {
  const db = getDb()
  const edits = state.resume?.cards ?? []
  const byKey = new Map(edits.map((edit) => [edit.key, edit]))
  const remaining = state.pendingCards.filter((card) => !byKey.has(card.key))
  const committed: ExtractCommitSummary = { ...state.committed }

  for (const edit of edits) {
    if (edit.action === 'skip') {
      committed.skipped++
      continue
    }

    if (edit.action === 'merge' && edit.entryId) {
      await db
        .update(tables.entries)
        .set({
          content: edit.payload.content,
          startAt: toDate(edit.payload.startAt),
          endAt: toDate(edit.payload.endAt),
          updatedAt: new Date(state.nowMs),
        })
        .where(
          and(eq(tables.entries.id, edit.entryId), eq(tables.entries.libraryId, state.libraryId)),
        )
      await syncEntryEmbedding(edit.entryId, edit.payload.title, edit.payload.content)
      committed.merged++
      continue
    }

    const id = randomUUID()
    await db.insert(tables.entries).values({
      id,
      userId: state.userId,
      libraryId: state.libraryId,
      type: edit.payload.type,
      title: edit.payload.title,
      content: edit.payload.content,
      status: 'active',
      startAt: toDate(edit.payload.startAt),
      endAt: toDate(edit.payload.endAt),
      recurrence: (edit.payload.recurrence ?? null) as Record<string, unknown> | null,
      recurrenceUntil: null,
      exceptions: null,
      sourceType: 'conversation',
      sourceRef: state.sessionId,
      confidence: edit.payload.confidence ?? 1,
      createdAt: new Date(state.nowMs),
      updatedAt: new Date(state.nowMs),
      archivedAt: null,
    })
    await syncEntryEmbedding(id, edit.payload.title, edit.payload.content)
    committed.created++
  }

  const parts: string[] = []
  if (committed.created > 0) parts.push(`新建 ${committed.created} 条`)
  if (committed.merged > 0) parts.push(`更新 ${committed.merged} 条`)
  if (committed.skipped > 0) parts.push(`跳过 ${committed.skipped} 条`)
  const reply = parts.length > 0 ? `已处理：${parts.join('，')}。` : '没有需要入库的记录。'

  return { pendingCards: remaining, committed, reply }
}

/** 终点：不做事，仅让条件边可以汇合到 END */
const finishNode: GraphNode<ExtractGraphState> = () => ({})

export const buildExtractGraph = (invoke?: (messages: ChatMessage[]) => Promise<string>) =>
  new StateGraph(ExtractState)
    .addNode(
      'extract',
      tracedNode<ExtractGraphState>('extract', 'extract', createExtractNode(invoke)),
    )
    .addNode('match', tracedNode<ExtractGraphState>('extract', 'match', matchNode))
    .addNode('buildCards', tracedNode<ExtractGraphState>('extract', 'buildCards', buildCardsNode))
    .addNode('confirm', tracedNode<ExtractGraphState>('extract', 'confirm', confirmNode))
    .addNode('commit', tracedNode<ExtractGraphState>('extract', 'commit', commitNode))
    .addNode('finish', tracedNode<ExtractGraphState>('extract', 'finish', finishNode))
    .addConditionalEdges(START, routeAtStart, ['extract', 'confirm'])
    .addConditionalEdges('extract', routeAfterExtract, ['match', 'buildCards', 'finish'])
    .addEdge('match', 'finish')
    .addConditionalEdges('buildCards', routeAfterCards, ['confirm', 'finish'])
    .addEdge('confirm', 'commit')
    .addConditionalEdges('commit', routeAfterCards, ['confirm', 'finish'])
    .addEdge('finish', END)

type CompiledExtractGraph = Awaited<ReturnType<typeof compileGraph>>

let compiled: Promise<CompiledExtractGraph> | null = null

const getExtractGraph = (): Promise<CompiledExtractGraph> => {
  if (!compiled) {
    compiled = compileGraph(buildExtractGraph()).catch((err: unknown) => {
      compiled = null
      throw err
    }) as Promise<CompiledExtractGraph>
  }
  return compiled
}

/** 测试用：清空编译缓存（模拟进程重启后重新编译） */
export const resetExtractGraph = (): void => {
  compiled = null
}

interface InterruptedResult {
  __interrupt__?: Array<{ value?: { type: string; data: { draftId: string; cards: DraftCard[] } } }>
  outcome: ExtractOutcome
  pendingCards?: DraftCard[]
  reply?: string
  committed?: ExtractCommitSummary
}

const threadConfig = (threadId: string) => ({ configurable: { thread_id: threadId } })

/** 首次抽取：返回中断（待确认卡片）或直接完成（cancel/delete/update/失败） */
export const runExtractGraph = async (input: ExtractGraphInput): Promise<ExtractGraphOutcome> => {
  // 注入 invoke 时单独编译一份（测试用），不影响生产实例的复用
  const graph: CompiledExtractGraph = input.invoke
    ? ((await compileGraph(buildExtractGraph(input.invoke))) as CompiledExtractGraph)
    : await getExtractGraph()
  const draftId = randomUUID()
  const threadId = extractThreadId(draftId)

  const result = (await graph.invoke(
    {
      text: input.text,
      sessionId: input.sessionId,
      userId: input.userId ?? 'local',
      libraryId: input.libraryId,
      nowMs: input.nowMs,
      timezone: input.timezone,
      draftId,
      committed: EMPTY_COMMIT,
    },
    threadConfig(threadId),
  )) as InterruptedResult

  if (isInterrupted(result)) {
    const payload = result.__interrupt__?.[0]?.value
    logger.info('extract.graph', '抽取完成，等待确认', {
      draftId,
      cardCount: payload?.data.cards.length ?? 0,
    })
    return {
      draftId,
      threadId,
      outcome: result.outcome,
      interrupted: true,
      cards: payload?.data.cards ?? [],
      reply: '',
      committed: EMPTY_COMMIT,
    }
  }

  return {
    draftId,
    threadId,
    outcome: result.outcome,
    interrupted: false,
    cards: result.pendingCards ?? [],
    reply: result.reply ?? '',
    committed: result.committed ?? EMPTY_COMMIT,
  }
}

export interface DocumentDraftInput {
  userId?: string
  libraryId: string
  sessionId: string | null
  /** 已由旧路径生成好的候选卡片（无 key） */
  cards: EntryCard[]
  nowMs: number
  timezone: string
}

/**
 * 文档抽取草稿：卡片已由文档抽取器生成，图从 `confirm` 开始挂起，
 * 与对话抽取共用同一个 thread 前缀、resume 与 GET 草稿接口。
 */
export const runDocumentDraftGraph = async (
  input: DocumentDraftInput,
): Promise<ExtractGraphOutcome> => {
  const graph = await getExtractGraph()
  const draftId = randomUUID()
  const threadId = extractThreadId(draftId)
  const pendingCards: DraftCard[] = input.cards.map((card, index) => ({
    ...card,
    key: `doc-${index}-${card.title}`,
  }))
  const outcome: ExtractOutcome = {
    ok: true,
    intent: 'record',
    reply: '',
    entries: [],
    truncated: false,
    remaining: 0,
    failed: null,
    rawText: '',
  }

  const result = (await graph.invoke(
    {
      text: '',
      sessionId: input.sessionId,
      userId: input.userId ?? 'local',
      libraryId: input.libraryId,
      nowMs: input.nowMs,
      timezone: input.timezone,
      outcome,
      draftId,
      committed: EMPTY_COMMIT,
      pendingCards,
    },
    threadConfig(threadId),
  )) as InterruptedResult

  if (isInterrupted(result)) {
    const payload = result.__interrupt__?.[0]?.value
    logger.info('extract.graph', '文档抽取完成，等待确认', {
      draftId,
      cardCount: payload?.data.cards.length ?? 0,
    })
    return {
      draftId,
      threadId,
      outcome: result.outcome,
      interrupted: true,
      cards: payload?.data.cards ?? [],
      reply: '',
      committed: EMPTY_COMMIT,
    }
  }

  return {
    draftId,
    threadId,
    outcome: result.outcome,
    interrupted: false,
    cards: result.pendingCards ?? [],
    reply: result.reply ?? '',
    committed: result.committed ?? EMPTY_COMMIT,
  }
}

/** 续跑：提交若干卡片的处理动作；仍有剩余卡片时会再次中断 */
export const resumeExtractGraph = async (
  threadId: string,
  payload: ExtractResumePayload,
): Promise<ExtractGraphOutcome> => {
  const ref = parseThreadId(threadId)
  if (!ref || ref.graph !== 'extract') throw new Error('无效的抽取 thread_id')

  const graph = await getExtractGraph()
  const result = (await graph.invoke(
    new Command({ resume: payload }),
    threadConfig(threadId),
  )) as InterruptedResult

  if (isInterrupted(result)) {
    const interrupted = result.__interrupt__?.[0]?.value
    return {
      draftId: ref.draftId,
      threadId,
      outcome: result.outcome,
      interrupted: true,
      cards: interrupted?.data.cards ?? result.pendingCards ?? [],
      reply: result.reply ?? '',
      committed: result.committed ?? EMPTY_COMMIT,
    }
  }

  return {
    draftId: ref.draftId,
    threadId,
    outcome: result.outcome,
    interrupted: false,
    cards: result.pendingCards ?? [],
    reply: result.reply ?? '',
    committed: result.committed ?? EMPTY_COMMIT,
  }
}

/** 读取未确认草稿（供 GET /api/extract/:threadId 与 resume 前置校验） */
export const readExtractDraft = async (
  threadId: string,
): Promise<{
  draftId: string
  cards: DraftCard[]
  sessionId: string | null
  libraryId: string
} | null> => {
  const ref = parseThreadId(threadId)
  if (!ref || ref.graph !== 'extract') return null

  const graph = await getExtractGraph()
  const snapshot = await graph.getState(threadConfig(threadId))
  const values = snapshot.values as ExtractGraphState
  const waitingConfirm = Array.isArray(snapshot.next) && snapshot.next.includes('confirm')
  if (!waitingConfirm || !values.pendingCards) return null

  return {
    draftId: ref.draftId,
    cards: values.pendingCards,
    sessionId: values.sessionId ?? null,
    libraryId: values.libraryId,
  }
}
