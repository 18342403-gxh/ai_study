/**
 * 抽取链路 — 去重与时间冲突检测（spec 4.3.4）
 *
 * 两道检查：
 *   1. 完全重复：标题 + 类型相同，且内容 cosine > 0.9
 *   2. 时间冲突：新日程与已有 active 日程时间段重叠（重复事件按窗口展开）
 *
 * 只提示，不自动合并、不自动覆盖。
 */

import { cosineSimilarity, getEmbedding } from '../rag/embeddings.js'
import { logger } from '../logger.js'
import { addLocalDays } from './timeParse.js'
import { expandOccurrences, type Recurrence } from './recurrence.js'
import type { ExtractedEntry } from './extractor.js'

/** 未提供结束时间时，按 1 小时估算事件长度 */
export const DEFAULT_EVENT_MS = 3_600_000

export interface ExistingEntry {
  id: string
  type: string
  title: string
  content: string
  startAt: number | null
  endAt: number | null
  recurrence: Recurrence | null
  recurrenceUntil: number | null
}

export interface DuplicateInfo {
  entryId: string
  title: string
  similarity: number
}

export interface ConflictInfo {
  entryId: string
  title: string
  start: number
  end: number | null
}

export interface DedupeInfo {
  duplicate: DuplicateInfo | null
  conflicts: ConflictInfo[]
}

/** 半开区间重叠判断（无结束时间按 1 小时估算） */
export const intervalsOverlap = (
  aStart: number,
  aEnd: number | null,
  bStart: number,
  bEnd: number | null,
): boolean => {
  const aEndMs = aEnd ?? aStart + DEFAULT_EVENT_MS
  const bEndMs = bEnd ?? bStart + DEFAULT_EVENT_MS
  return aStart < bEndMs && bStart < aEndMs
}

const normalizeTitle = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？,.!?]/g, '')

const normalizeContent = (content: string): string =>
  content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？,.!?]/g, '')

/** 完全重复：类型 + 标题一致，内容相似度 > 0.9 */
export const findExactDuplicate = (
  candidate: ExtractedEntry,
  existing: ExistingEntry[],
  similarityOf: (entry: ExistingEntry) => number,
): DuplicateInfo | null => {
  for (const entry of existing) {
    if (entry.type !== candidate.type) continue
    if (normalizeTitle(entry.title) !== normalizeTitle(candidate.title)) continue
    const similarity = similarityOf(entry)
    if (similarity > 0.9) {
      return { entryId: entry.id, title: entry.title, similarity }
    }
  }
  return null
}

/** 新日程与已有 active 日程的时间冲突 */
export const findTimeConflicts = (
  candidate: ExtractedEntry,
  existing: ExistingEntry[],
  nowMs: number,
  limit = 5,
): ConflictInfo[] => {
  if (candidate.type !== 'schedule' || !candidate.time) return []

  const newStart = candidate.time.start
  const newEnd = candidate.time.end ?? newStart + DEFAULT_EVENT_MS
  const conflicts: ConflictInfo[] = []

  for (const entry of existing) {
    if (entry.type !== 'schedule' || entry.startAt === null) continue

    if (!entry.recurrence) {
      if (intervalsOverlap(newStart, newEnd, entry.startAt, entry.endAt)) {
        conflicts.push({
          entryId: entry.id,
          title: entry.title,
          start: entry.startAt,
          end: entry.endAt,
        })
      }
    } else {
      const until = entry.recurrenceUntil ?? entry.recurrence.until ?? addLocalDays(nowMs, 365)
      const duration = Math.max(DEFAULT_EVENT_MS, (entry.endAt ?? 0) - entry.startAt)
      const occurrences = expandOccurrences({
        startAt: entry.startAt,
        endAt: entry.endAt,
        recurrence: { ...entry.recurrence, until },
        windowStart: newStart - duration,
        windowEnd: newEnd,
        limit: 60,
      })
      const hit = occurrences.find((occ) => intervalsOverlap(newStart, newEnd, occ.start, occ.end))
      if (hit) {
        conflicts.push({
          entryId: entry.id,
          title: entry.title,
          start: hit.start,
          end: hit.end,
        })
      }
    }

    if (conflicts.length >= limit) break
  }

  return conflicts
}

const entryText = (entry: { title: string; content: string }): string =>
  [entry.title, entry.content].filter(Boolean).join('\n')

/**
 * 计算单条候选的去重信息。
 * 只有「类型 + 标题」相同才计算 embedding，避免无谓的 API 调用。
 */
export const buildDedupeInfo = async (
  candidate: ExtractedEntry,
  existing: ExistingEntry[],
  nowMs: number,
): Promise<DedupeInfo> => {
  const conflicts = findTimeConflicts(candidate, existing, nowMs)

  const sameShape = existing.filter(
    (entry) =>
      entry.type === candidate.type &&
      normalizeTitle(entry.title) === normalizeTitle(candidate.title),
  )

  let duplicate: DuplicateInfo | null = null
  if (sameShape.length > 0) {
    // 内容完全一致时直接判定重复，省掉一次 embedding 调用
    const identical = sameShape.find(
      (entry) =>
        normalizeContent(entry.content) !== '' &&
        normalizeContent(entry.content) === normalizeContent(candidate.content),
    )
    if (identical) {
      duplicate = { entryId: identical.id, title: identical.title, similarity: 1 }
    } else {
      try {
        const candidateVector = await getEmbedding(entryText(candidate))
        const similarities = new Map<string, number>()
        for (const entry of sameShape.slice(0, 5)) {
          const vector = await getEmbedding(entryText(entry))
          similarities.set(entry.id, cosineSimilarity(candidateVector, vector))
        }
        duplicate = findExactDuplicate(
          candidate,
          sameShape,
          (entry) => similarities.get(entry.id) ?? 0,
        )
      } catch (err) {
        logger.warn('extract', '去重向量计算失败，跳过重复检测', {
          error: (err as Error).message,
        })
      }
    }
  }

  return { duplicate, conflicts }
}
