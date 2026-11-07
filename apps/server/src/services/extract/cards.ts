/**
 * 抽取链路 — 确认卡片组装（对话 / 文档共用）
 *
 * 把抽取结果与已有条目做去重、冲突检测，并补充可直接展示的绝对时间文本。
 */

import {
  buildDedupeInfo,
  type ConflictInfo,
  type DuplicateInfo,
  type ExistingEntry,
} from './dedupe.js'
import type { ExtractedEntry } from './extractor.js'
import { formatDateTime, formatRecurrenceText } from './timeParse.js'
import type { Recurrence } from './recurrence.js'

/** 数据库行（entries）中卡片所需的最小结构 */
export interface EntryRowLike {
  id: string
  type: string
  title: string
  content: string
  startAt: Date | null
  endAt: Date | null
  recurrence: unknown
  recurrenceUntil: Date | null
}

export type EntryCard = ExtractedEntry & {
  duplicate: DuplicateInfo | null
  conflicts: (ConflictInfo & { startText: string; endText: string | null })[]
}

const toRecurrence = (value: unknown): Recurrence | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const freq = (value as Record<string, unknown>).freq
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null
  return value as Recurrence
}

export const rowToExisting = (row: EntryRowLike): ExistingEntry => ({
  id: row.id,
  type: row.type,
  title: row.title,
  content: row.content,
  startAt: row.startAt ? row.startAt.getTime() : null,
  endAt: row.endAt ? row.endAt.getTime() : null,
  recurrence: toRecurrence(row.recurrence),
  recurrenceUntil: row.recurrenceUntil ? row.recurrenceUntil.getTime() : null,
})

export const rowTimeText = (row: EntryRowLike): string | undefined => {
  const recurrence = toRecurrence(row.recurrence)
  if (recurrence && row.startAt) return formatRecurrenceText(recurrence, row.startAt.getTime())
  return row.startAt ? formatDateTime(row.startAt.getTime()) : undefined
}

/** 字符二元组相似度 — 用于挑出最相关的已有记录（避免为 Prompt 额外调用 embedding） */
const bigramSimilarity = (a: string, b: string): number => {
  const grams = (text: string) => {
    const clean = text.replace(/\s+/g, '').toLowerCase()
    const set = new Set<string>()
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2))
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let shared = 0
  for (const gram of ga) if (gb.has(gram)) shared++
  return shared / Math.max(ga.size, gb.size)
}

/** 从已有记录中挑出最相关的若干条，注入 Prompt（spec 4.3.5：最多 5 条） */
export const pickRelated = <T extends { title: string; content: string }>(
  text: string,
  rows: T[],
  limit = 5,
): T[] => {
  if (rows.length <= limit) return rows
  return [...rows]
    .map((row) => ({ row, score: bigramSimilarity(text, `${row.title}${row.content}`) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.row)
}

/** 抽取结果 → 确认卡片（串行去重，避免同时打爆 embedding 接口） */
export const buildEntryCards = async (
  entries: ExtractedEntry[],
  existing: ExistingEntry[],
  nowMs: number,
  timezone: string,
): Promise<EntryCard[]> => {
  const cards: EntryCard[] = []
  for (const entry of entries) {
    const info = await buildDedupeInfo(entry, existing, nowMs)
    cards.push({
      ...entry,
      duplicate: info.duplicate,
      conflicts: info.conflicts.map((conflict) => ({
        ...conflict,
        startText: formatDateTime(conflict.start, timezone),
        endText: conflict.end !== null ? formatDateTime(conflict.end, timezone) : null,
      })),
    })
  }
  return cards
}
