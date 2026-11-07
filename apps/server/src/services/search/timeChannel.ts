/**
 * 时间通道 — spec 4.5.2 通道 A（确定性）
 *
 * 单次事件走 SQL 区间过滤；重复事件取规则后在应用层展开（spec 4.3.7），
 * 展开实例参与同一套加权排序。
 */

import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm'

import { getDb, tables } from '../../db/index.js'
import { expandOccurrences, normalizeRecurrence } from '../extract/recurrence.js'
import { DAY_MS, startOfLocalDay } from '../extract/timeParse.js'

type EntryRow = typeof tables.entries.$inferSelect

export interface TimeChannelHit {
  entry: EntryRow
  /** 命中实例的开始时间（重复事件为展开后的实例） */
  startAt: number
  endAt: number | null
  /** 是否为重复事件展开实例 */
  occurrence: boolean
  score: number
}

export interface TimeChannelOptions {
  windowStart: number
  windowEnd: number
  libraryId?: string
  /** 用户明确问"历史/上个月"时放宽到 archived（spec 4.5.2） */
  includeArchived?: boolean
  now?: number
  limit?: number
}

const MAX_SINGLE_HITS = 20
const MAX_RECURRING_ROWS = 200
const MAX_EXPAND_HITS = 120

/** 距离当前时间越近分越高（7 天衰减一半），保证时间通道内部有稳定顺序 */
const timeScore = (startAt: number, nowMs: number): number =>
  1 / (1 + Math.abs(startAt - nowMs) / (7 * DAY_MS))

export const searchTimeChannel = async (options: TimeChannelOptions): Promise<TimeChannelHit[]> => {
  const nowMs = options.now ?? Date.now()
  const windowStart = startOfLocalDay(options.windowStart)
  const windowEnd = options.windowEnd
  const statusCond: SQL | undefined = options.includeArchived
    ? or(eq(tables.entries.status, 'active'), eq(tables.entries.status, 'archived'))
    : eq(tables.entries.status, 'active')
  const libraryCond = options.libraryId
    ? eq(tables.entries.libraryId, options.libraryId)
    : undefined

  const db = getDb()

  // 第一步：单次事件（schedule / plan）
  const singleRows = await db
    .select()
    .from(tables.entries)
    .where(
      and(
        statusCond,
        libraryCond,
        or(eq(tables.entries.type, 'schedule'), eq(tables.entries.type, 'plan')),
        isNull(tables.entries.recurrence),
        isNotNull(tables.entries.startAt),
        lt(tables.entries.startAt, new Date(windowEnd)),
        sql`coalesce(${tables.entries.endAt}, ${tables.entries.startAt}) >= ${windowStart}`,
      ),
    )
    .orderBy(asc(tables.entries.startAt))
    .limit(MAX_SINGLE_HITS)

  const hits: TimeChannelHit[] = singleRows.map((row) => {
    const start = row.startAt!.getTime()
    return {
      entry: row,
      startAt: start,
      endAt: row.endAt ? row.endAt.getTime() : null,
      occurrence: false,
      score: timeScore(start, nowMs),
    }
  })

  // 第二步：重复事件（取规则，应用层展开）
  const recurringRows = await db
    .select()
    .from(tables.entries)
    .where(
      and(
        eq(tables.entries.status, 'active'),
        libraryCond,
        eq(tables.entries.type, 'schedule'),
        isNotNull(tables.entries.recurrence),
        isNotNull(tables.entries.startAt),
        or(
          isNull(tables.entries.recurrenceUntil),
          gte(tables.entries.recurrenceUntil, new Date(windowStart)),
        ),
      ),
    )
    .limit(MAX_RECURRING_ROWS)

  for (const row of recurringRows) {
    const startAt = row.startAt!.getTime()
    const { recurrence } = normalizeRecurrence(row.recurrence, nowMs, startAt)
    if (!recurrence) continue

    const occurrences = expandOccurrences({
      startAt,
      endAt: row.endAt ? row.endAt.getTime() : null,
      recurrence,
      windowStart,
      windowEnd,
    })
    for (const occurrence of occurrences) {
      hits.push({
        entry: row,
        startAt: occurrence.start,
        endAt: occurrence.end,
        occurrence: true,
        score: timeScore(occurrence.start, nowMs),
      })
      if (hits.length >= MAX_EXPAND_HITS) break
    }
    if (hits.length >= MAX_EXPAND_HITS) break
  }

  hits.sort((a, b) => a.startAt - b.startAt)
  return options.limit ? hits.slice(0, options.limit) : hits
}
