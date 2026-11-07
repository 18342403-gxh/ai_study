/**
 * 抽取链路 — 时间解析与校验（纯函数）
 *
 * 分工（spec 4.3.3）：
 *   - 模型负责把自然语言时间解析成带时区的 ISO 8601
 *   - 代码侧负责校验：ISO 格式、是否在过去、起止是否颠倒
 *   - 模型没给出可用时间时，用本文件的相对时间兜底解析（覆盖 spec 4.3.3 规则表）
 *
 * 所有时间统一用毫秒时间戳，时区按本机。
 */

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export const DAY_MS = 86_400_000

/** 本机时区（IANA 名称） */
export const getLocalTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

/** 本地时区的当天 00:00 */
export const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 按本地日历加减天数（避免跨 DST 用毫秒直加） */
export const addLocalDays = (ms: number, days: number): number => {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** ISO 星期：1=周一 … 7=周日 */
export const isoWeekday = (ms: number): number => {
  const day = new Date(ms).getDay()
  return day === 0 ? 7 : day
}

export const weekdayFromMs = (ms: number): Weekday => WEEKDAYS[isoWeekday(ms) - 1]

/** 两个本地日期相差的自然天数 */
export const daysBetweenLocal = (fromMs: number, toMs: number): number =>
  Math.round((startOfLocalDay(toMs) - startOfLocalDay(fromMs)) / DAY_MS)

const WEEKDAY_CN: Record<Weekday, string> = {
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六',
  SU: '日',
}

// ─────────────────────────────────────────────
// ISO 8601 解析与校验
// ─────────────────────────────────────────────

/** 严格匹配 ISO 8601 日期 / 日期时间（时间部分可省略时区） */
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * 把模型返回的时间解析成毫秒。
 * - number：直接当作毫秒时间戳
 * - 纯日期（2026-11-11）：按本地 00:00
 * - 无时区的日期时间（2026-11-11T14:00:00）：按本地时间
 * - 带时区（2026-11-11T14:00:00+08:00 / Z）：按标注时区
 * 非法格式返回 null。
 */
export const parseIsoTime = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  const text = value.trim()
  const m = ISO_RE.exec(text)
  if (!m) return null

  let normalized = text.replace(' ', 'T')
  if (!m[4]) normalized = `${normalized}T00:00:00`

  const ms = new Date(normalized).getTime()
  return Number.isFinite(ms) ? ms : null
}

export interface TimeValidation {
  start: number | null
  end: number | null
  past: boolean
  warnings: string[]
}

/**
 * 校验起止时间：
 *   - 起止颠倒 → 丢弃结束时间
 *   - 开始时间在过去 → 标记提醒（重复事件另作说明）
 *   - 只有结束没有开始 → 丢弃结束
 */
export const validateTimeRange = (
  start: number | null,
  end: number | null,
  nowMs: number,
  opts: { recurring?: boolean } = {},
): TimeValidation => {
  const warnings: string[] = []
  const nextStart = start
  let nextEnd = end
  let past = false

  if (nextStart === null && nextEnd !== null) {
    nextEnd = null
    warnings.push('只有结束时间没有开始时间，已忽略结束时间')
  }

  if (nextStart !== null && nextEnd !== null && nextEnd < nextStart) {
    nextEnd = null
    warnings.push('结束时间早于开始时间，已忽略结束时间')
  }

  if (nextStart !== null && nextStart < nowMs) {
    past = true
    warnings.push(
      opts.recurring ? '开始时间已过去，将按重复规则从下一次开始' : '时间已过去，请核对',
    )
  }

  return { start: nextStart, end: nextEnd, past, warnings }
}

// ─────────────────────────────────────────────
// 格式化（确认卡片回显绝对时间）
// ─────────────────────────────────────────────

const collectParts = (ms: number, tz: string, options: Intl.DateTimeFormatOptions) => {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    hourCycle: 'h23',
    ...options,
  }).formatToParts(new Date(ms))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  return { get }
}

/** 2026-11-07 周六 10:00 */
export const formatDateTime = (ms: number, tz = getLocalTimezone()): string => {
  const { get } = collectParts(ms, tz, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${get('year')}-${get('month')}-${get('day')} ${get('weekday')} ${get('hour')}:${get('minute')}`
}

/** 2026-11-07 */
export const formatDate = (ms: number, tz = getLocalTimezone()): string => {
  const { get } = collectParts(ms, tz, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** 09:00 */
export const formatClock = (ms: number, tz = getLocalTimezone()): string => {
  const { get } = collectParts(ms, tz, { hour: '2-digit', minute: '2-digit' })
  return `${get('hour')}:${get('minute')}`
}

// ─────────────────────────────────────────────
// 相对时间兜底解析（模型没给 start 时使用）
// ─────────────────────────────────────────────

export interface RelativeRecurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  interval?: number
  byWeekday?: Weekday[]
  byMonthDay?: number
}

export interface RelativeTimeResult {
  start: number | null
  end: number | null
  recurrence: RelativeRecurrence | null
  confidence: number
  warnings: string[]
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

/** 中文数字（1-99）转 int，失败返回 null */
const cnToInt = (text: string): number | null => {
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '十') return 10
  if (text.length === 1) return CN_DIGITS[text] ?? null
  const [tens, ones] = text.split('十')
  const t = tens === '' ? 1 : (CN_DIGITS[tens] ?? null)
  const o = ones === '' || ones === undefined ? 0 : (CN_DIGITS[ones] ?? null)
  if (t === null || o === null) return null
  return t * 10 + o
}

/** 解析时间点：下午两点 / 9:30 / 晚上八点 / 9点一刻 */
const parseClock = (text: string): { hour: number; minute: number; explicit: boolean } | null => {
  const colon = /(\d{1,2}):(\d{2})/.exec(text)
  if (colon) {
    return { hour: Number(colon[1]), minute: Number(colon[2]), explicit: true }
  }

  const m =
    /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*[点时](半|一刻|(\d{1,2})分?)?/.exec(
      text,
    )
  if (!m) return null
  const hour = cnToInt(m[2])
  if (hour === null || hour > 24) return null

  let minute = 0
  if (m[3] === '半') minute = 30
  else if (m[3] === '一刻') minute = 15
  else if (m[4]) minute = Number(m[4])

  const prefix = m[1]
  let finalHour = hour
  if (prefix === '下午' || prefix === '傍晚' || prefix === '晚上') {
    if (finalHour < 12) finalHour += 12
  } else if (prefix === '中午') {
    if (finalHour < 11) finalHour += 12
  } else if (prefix === '凌晨') {
    if (finalHour >= 12) finalHour -= 12
  }

  return { hour: finalHour, minute, explicit: prefix !== undefined }
}

const WEEKDAY_CHAR: Record<string, Weekday> = {
  一: 'MO',
  二: 'TU',
  三: 'WE',
  四: 'TH',
  五: 'FR',
  六: 'SA',
  日: 'SU',
  天: 'SU',
}

/** 从原文中提取明确写出的星期（用于校验模型给的时间是否对得上） */
export const parseStatedWeekday = (raw: string): Weekday | null => {
  const m = /(?:周|星期|礼拜)([一二三四五六日天])/.exec(raw)
  return m ? (WEEKDAY_CHAR[m[1]] ?? null) : null
}

/** 解析「每周一、周三」这类星期列表 */
const parseWeekdayList = (text: string): Weekday[] => {
  const found: Weekday[] = []
  const re = /(?:周|星期|礼拜)([一二三四五六日天])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const wd = WEEKDAY_CHAR[m[1]]
    if (wd && !found.includes(wd)) found.push(wd)
  }
  return found.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
}

/** 某自然周内目标星期的日期（weekAnchor 所在周，ISO 周一起） */
const weekdayInWeek = (weekAnchorMs: number, weekday: Weekday): number => {
  const target = WEEKDAYS.indexOf(weekday) + 1
  const delta = target - isoWeekday(weekAnchorMs)
  return addLocalDays(startOfLocalDay(weekAnchorMs), delta)
}

/** 下一个目标星期（含当天） */
const nextWeekday = (nowMs: number, weekday: Weekday): number => {
  const delta = (WEEKDAYS.indexOf(weekday) + 1 - isoWeekday(nowMs) + 7) % 7
  return addLocalDays(startOfLocalDay(nowMs), delta)
}

/** 当月最后一天 */
const endOfMonth = (ms: number): number => {
  const d = new Date(ms)
  d.setMonth(d.getMonth() + 1, 0)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const startOfMonth = (ms: number): number => {
  const d = new Date(ms)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const atClock = (dayMs: number, clock: { hour: number; minute: number } | null): number => {
  const d = new Date(dayMs)
  d.setHours(clock?.hour ?? 0, clock?.minute ?? 0, 0, 0)
  return d.getTime()
}

/**
 * 相对时间兜底解析。无法识别返回 null。
 * 覆盖 spec 4.3.3：今天/明天/后天、下周X、本周X、下午两点、月底/月初、三天后、
 * 每周一、每个工作日、每月 5 号。
 */
export const parseRelativeTime = (raw: string, nowMs: number): RelativeTimeResult | null => {
  const text = raw.trim()
  if (!text) return null

  const warnings: string[] = []
  const clock = parseClock(text)

  // ── 重复规则 ──────────────────────────────
  let recurrence: RelativeRecurrence | null = null
  if (/每(?:个)?工作日/.test(text)) {
    recurrence = { freq: 'WEEKLY', byWeekday: ['MO', 'TU', 'WE', 'TH', 'FR'] }
  } else if (/每天|每日/.test(text)) {
    recurrence = { freq: 'DAILY', interval: 1 }
  } else if (/每(?:隔)?\s*(\d+|[一二两三四五六七八九十])\s*天/.test(text)) {
    const m = /每(?:隔)?\s*(\d+|[一二两三四五六七八九十])\s*天/.exec(text)!
    const n = cnToInt(m[1]) ?? 1
    recurrence = { freq: 'DAILY', interval: Math.max(1, n) }
  } else if (/(?:每|每个)(?:周|星期|礼拜)/.test(text)) {
    const days = parseWeekdayList(text)
    if (days.length > 0) recurrence = { freq: 'WEEKLY', byWeekday: days }
  } else if (/每月/.test(text) && /最后一天|末日/.test(text)) {
    recurrence = { freq: 'MONTHLY', byMonthDay: 31 }
    warnings.push('月末按每月 31 日近似，短月份会跳过')
  } else if (/每月/.test(text)) {
    const m = /每月\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[号日]/.exec(text)
    const day = m ? cnToInt(m[1]) : null
    if (day !== null && day >= 1 && day <= 31) {
      recurrence = { freq: 'MONTHLY', byMonthDay: day }
    }
  } else if (/每年|每季度|每月第/.test(text)) {
    warnings.push('暂不支持该重复方式，已按单次事件处理')
  }

  if (recurrence) {
    if (!clock) warnings.push('未指定具体时间')
    const firstDay = firstRecurrenceDay(recurrence, nowMs)
    return {
      start: atClock(firstDay, clock),
      end: null,
      recurrence,
      confidence: clock ? 0.75 : 0.7,
      warnings,
    }
  }

  // ── 单次时间：先确定日期，再叠加时间点 ────
  let day: number | null = null
  let confidence = 0.8

  if (/大后天/.test(text)) day = addLocalDays(startOfLocalDay(nowMs), 3)
  else if (/后天/.test(text)) day = addLocalDays(startOfLocalDay(nowMs), 2)
  else if (/明天|明日/.test(text)) day = addLocalDays(startOfLocalDay(nowMs), 1)
  else if (/今天|今日|今晚/.test(text)) day = startOfLocalDay(nowMs)

  if (day === null) {
    const afterDays = /(\d+|[一二两三四五六七八九十])\s*天(?:之?后|以后)/.exec(text)
    if (afterDays) {
      const n = cnToInt(afterDays[1])
      if (n !== null) {
        // 同时刻：原文另给时间点则按今天该时间点顺延
        const base = clock ? atClock(nowMs, clock) : nowMs
        return {
          start: addLocalDays(base, n),
          end: null,
          recurrence: null,
          confidence: 0.8,
          warnings,
        }
      }
    }
  }

  if (day === null) {
    const afterHours = /(\d+|[一二两三四五六七八九十])\s*个?小时(?:之?后|以后)/.exec(text)
    if (afterHours) {
      const n = cnToInt(afterHours[1])
      if (n !== null) {
        return {
          start: nowMs + n * 3_600_000,
          end: null,
          recurrence: null,
          confidence: 0.8,
          warnings,
        }
      }
    }
  }

  if (day === null) {
    const nextWeek = /下(?:个)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(text)
    if (nextWeek) {
      day = weekdayInWeek(addLocalDays(startOfLocalDay(nowMs), 7), WEEKDAY_CHAR[nextWeek[1]])
    }
  }

  if (day === null) {
    const thisWeek = /(?:本|这)(?:周|星期|礼拜)([一二三四五六日天])/.exec(text)
    if (thisWeek) {
      day = weekdayInWeek(nowMs, WEEKDAY_CHAR[thisWeek[1]])
      if (day < startOfLocalDay(nowMs)) warnings.push('本周已过')
    }
  }

  if (day === null) {
    const explicitWeekday = /(?:周|星期|礼拜)([一二三四五六日天])/.exec(text)
    if (explicitWeekday) day = nextWeekday(nowMs, WEEKDAY_CHAR[explicitWeekday[1]])
  }

  if (day === null) {
    if (/月底|月末/.test(text)) {
      day = endOfMonth(nowMs)
      confidence = 0.5
      warnings.push('时间不够精确，请核对')
    } else if (/月初/.test(text)) {
      day = startOfMonth(nowMs)
      confidence = 0.5
      warnings.push('时间不够精确，请核对')
    } else {
      const monthDay = /(\d{1,2})\s*[号日]/.exec(text)
      if (monthDay) {
        const d = new Date(nowMs)
        const targetDay = Number(monthDay[1])
        d.setDate(targetDay)
        d.setHours(0, 0, 0, 0)
        day = d.getTime()
        confidence = 0.55
        warnings.push('未说明月份，已按本月计算，请核对')
      }
    }
  }

  if (day === null && clock) {
    day = startOfLocalDay(nowMs)
    confidence = 0.6
    warnings.push('未说明日期，已按今天计算')
  }

  if (day === null) return null

  const start = atClock(day, clock)
  if (clock && !clock.explicit && clock.hour <= 6) {
    confidence = Math.min(confidence, 0.6)
    warnings.push('时间点不确定是上午还是下午，请核对')
  }

  return { start, end: null, recurrence: null, confidence, warnings }
}

/** 重复规则的首个发生日（本地 00:00） */
export const firstRecurrenceDay = (recurrence: RelativeRecurrence, nowMs: number): number => {
  const today = startOfLocalDay(nowMs)

  if (recurrence.freq === 'DAILY') return today

  if (recurrence.freq === 'WEEKLY') {
    const days = recurrence.byWeekday ?? [weekdayFromMs(nowMs)]
    let best: number | null = null
    for (const wd of days) {
      const candidate = nextWeekday(nowMs, wd)
      if (best === null || candidate < best) best = candidate
    }
    return best ?? today
  }

  const targetDay = recurrence.byMonthDay ?? new Date(nowMs).getDate()
  const d = new Date(nowMs)
  d.setDate(Math.min(targetDay, 31))
  d.setHours(0, 0, 0, 0)
  if (d.getTime() < today) {
    d.setMonth(d.getMonth() + 1, Math.min(targetDay, 31))
    d.setHours(0, 0, 0, 0)
  }
  return d.getTime()
}

/** 重复规则的可读文本，例：每周一 09:00，持续到 2027-11-06 */
export const formatRecurrenceText = (
  recurrence: RelativeRecurrence & { until?: number },
  startMs: number | null,
): string => {
  const clockText = startMs !== null ? formatClock(startMs) : ''
  let rule = ''

  if (recurrence.freq === 'DAILY') {
    const interval = recurrence.interval ?? 1
    rule = interval <= 1 ? '每天' : `每 ${interval} 天`
  } else if (recurrence.freq === 'WEEKLY') {
    const days = recurrence.byWeekday ?? []
    const isWorkday = days.length === 5 && days.every((d, i) => d === WEEKDAYS[i])
    rule = isWorkday ? '每个工作日' : `每周${days.map((d) => WEEKDAY_CN[d]).join('、')}`
  } else {
    rule = `每月 ${recurrence.byMonthDay ?? 1} 号`
  }

  const head = clockText ? `${rule} ${clockText}` : rule
  return recurrence.until ? `${head}，持续到 ${formatDate(recurrence.until)}` : head
}
