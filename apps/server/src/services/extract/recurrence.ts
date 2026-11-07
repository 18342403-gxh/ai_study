/**
 * 抽取链路 — 重复规则（RRULE 子集）规范化与展开（纯函数）
 *
 * 仅支持 spec 4.3.7 的子集：
 *   DAILY   + interval
 *   WEEKLY  + byWeekday
 *   MONTHLY + byMonthDay
 *
 * 存储策略：只存规则，不物化实例；检索时按时间窗口展开（单规则单次上限 60 个实例）。
 */

import {
  DAY_MS,
  WEEKDAYS,
  addLocalDays,
  daysBetweenLocal,
  isoWeekday,
  parseIsoTime,
  startOfLocalDay,
  weekdayFromMs,
  type Weekday,
} from './timeParse.js'

export interface Recurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  interval?: number
  byWeekday?: Weekday[]
  byMonthDay?: number
  /** 毫秒时间戳；抽取时缺省为录入时间 + 1 年 */
  until: number
}

export interface NormalizedRecurrence {
  recurrence: Recurrence | null
  warnings: string[]
}

const toInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

const normalizeWeekdays = (value: unknown): Weekday[] => {
  if (!Array.isArray(value)) return []
  const result: Weekday[] = []
  for (const item of value) {
    const upper = String(item).trim().toUpperCase()
    if ((WEEKDAYS as string[]).includes(upper) && !result.includes(upper as Weekday)) {
      result.push(upper as Weekday)
    }
  }
  return result.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
}

/**
 * 模型输出的 recurrence → 规范化 RRULE 子集。
 * 不支持的方式降级为 null（单次事件），并给出提示。
 */
export const normalizeRecurrence = (
  input: unknown,
  nowMs: number,
  startMs: number | null = null,
): NormalizedRecurrence => {
  if (input === null || input === undefined) return { recurrence: null, warnings: [] }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { recurrence: null, warnings: ['重复规则格式无法识别，已按单次事件处理'] }
  }

  const raw = input as Record<string, unknown>
  const freq = String(raw.freq ?? raw.frequency ?? '')
    .trim()
    .toUpperCase()

  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') {
    return { recurrence: null, warnings: ['暂不支持该重复方式，已按单次事件处理'] }
  }

  // 每年 / 每月第 N 个周几 / BYSETPOS 等复杂规则一律降级
  if (raw.bySetPos !== undefined || raw.bySetPosition !== undefined) {
    return { recurrence: null, warnings: ['暂不支持该重复方式，已按单次事件处理'] }
  }

  const warnings: string[] = []
  let until = parseIsoTime(raw.until)
  const defaultUntil = addLocalDays(nowMs, 365)

  if (until === null) {
    until = defaultUntil
  } else if (startMs !== null && until <= startMs) {
    until = addLocalDays(startMs, 365)
    warnings.push('重复结束时间早于开始时间，已改为一年后')
  } else if (until <= nowMs) {
    until = defaultUntil
    warnings.push('重复结束时间已过去，已延长至一年后')
  }

  if (freq === 'DAILY') {
    const interval = Math.min(365, Math.max(1, toInt(raw.interval) ?? 1))
    return { recurrence: { freq: 'DAILY', interval, until }, warnings }
  }

  if (freq === 'WEEKLY') {
    let byWeekday = normalizeWeekdays(raw.byWeekday)
    if (byWeekday.length === 0) {
      if (startMs !== null) {
        byWeekday = [weekdayFromMs(startMs)]
        warnings.push('重复规则缺少星期，已按开始时间所在星期处理')
      } else {
        return { recurrence: null, warnings: ['重复规则缺少星期，已按单次事件处理'] }
      }
    }
    return { recurrence: { freq: 'WEEKLY', byWeekday, until }, warnings }
  }

  let byMonthDay = toInt(raw.byMonthDay)
  if (byMonthDay === null || byMonthDay < 1 || byMonthDay > 31) {
    if (startMs !== null) {
      byMonthDay = new Date(startMs).getDate()
      warnings.push('重复规则缺少日期，已按开始时间所在日期处理')
    } else {
      return { recurrence: null, warnings: ['重复规则缺少日期，已按单次事件处理'] }
    }
  }

  return { recurrence: { freq: 'MONTHLY', byMonthDay, until }, warnings }
}

export interface Occurrence {
  start: number
  end: number | null
}

export interface ExpandParams {
  startAt: number
  endAt: number | null
  recurrence: Recurrence
  windowStart: number
  windowEnd: number
  /** 单条规则单次展开上限（spec 4.3.7：60） */
  limit?: number
}

const daysInMonth = (ms: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

const matchesRule = (recurrence: Recurrence, startAt: number, dayMs: number): boolean => {
  if (recurrence.freq === 'DAILY') {
    const interval = recurrence.interval ?? 1
    const diff = daysBetweenLocal(startAt, dayMs)
    return diff >= 0 && diff % interval === 0
  }
  if (recurrence.freq === 'WEEKLY') {
    const weekday = WEEKDAYS[isoWeekday(dayMs) - 1]
    return (recurrence.byWeekday ?? [weekdayFromMs(startAt)]).includes(weekday)
  }
  const target = recurrence.byMonthDay ?? new Date(startAt).getDate()
  // 月末近似：目标 31 号时，短月份取当月最后一天
  if (target === 31) return new Date(dayMs).getDate() === daysInMonth(dayMs)
  return new Date(dayMs).getDate() === target
}

/**
 * 在 [windowStart, windowEnd] 内展开重复规则。
 * 返回的 occurrence.end 由原事件的时长推导；无结束时间则为 null。
 */
export const expandOccurrences = (params: ExpandParams): Occurrence[] => {
  const { startAt, endAt, recurrence, windowStart, windowEnd } = params
  const limit = params.limit ?? 60

  const duration = endAt !== null && endAt > startAt ? endAt - startAt : null
  const timeOfDayOffset = startAt - startOfLocalDay(startAt)
  const firstDay = startOfLocalDay(startAt)
  const from = startOfLocalDay(Math.max(startAt, windowStart))
  const to = startOfLocalDay(Math.min(windowEnd, recurrence.until))

  const occurrences: Occurrence[] = []
  for (let day = from; day <= to && occurrences.length < limit; day = addLocalDays(day, 1)) {
    if (day < firstDay) continue
    if (!matchesRule(recurrence, startAt, day)) continue

    const occStart = day + timeOfDayOffset
    if (occStart < windowStart || occStart > windowEnd) continue
    occurrences.push({ start: occStart, end: duration !== null ? occStart + duration : null })
  }

  return occurrences
}

/** 规则在 now 之后（含当天）的首个发生时间 */
export const nextOccurrenceAfter = (
  startAt: number,
  recurrence: Recurrence,
  nowMs: number,
): number | null => {
  const occurrences = expandOccurrences({
    startAt,
    endAt: null,
    recurrence,
    windowStart: Math.max(startOfLocalDay(nowMs), startAt),
    windowEnd: Math.min(recurrence.until, addLocalDays(nowMs, 400)),
    limit: 1,
  })
  return occurrences[0]?.start ?? null
}

/**
 * 把开始时间对齐到重复规则的首次发生：
 *   - 已经匹配规则且不在过去 → 原样返回
 *   - 星期 / 日期不匹配或已过去 → 取下一次发生时间
 */
export const alignRecurrenceStart = (
  startAt: number,
  recurrence: Recurrence,
  nowMs: number,
): number | null => {
  if (startAt >= nowMs && matchesRule(recurrence, startAt, startAt)) return startAt

  const next = nextOccurrenceAfter(startAt, recurrence, nowMs)
  if (next !== null) return next

  // 原起点不匹配规则时，用「今天」作为锚点重新推算
  return nextOccurrenceAfter(startOfLocalDay(nowMs), recurrence, nowMs)
}

/** 仅用于测试 / 调试：规则在一年内的实例数 */
export const countOccurrencesInYear = (startAt: number, recurrence: Recurrence): number =>
  expandOccurrences({
    startAt,
    endAt: null,
    recurrence,
    windowStart: startAt,
    windowEnd: startAt + 365 * DAY_MS,
    limit: 9999,
  }).length
