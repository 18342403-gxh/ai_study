/**
 * 查询理解 — spec 4.5.1
 *
 * 一次轻量 LLM 调用解析：是否需要个人上下文、时间窗口、关键词、目标类型；
 * 模型失败/超时/输出非法时降级为规则解析（deterministic），保证检索永远可用。
 */

import { createChatChain } from '../chain/chatChain.js'
import type { ChatMessage } from '../chain/model.js'
import { logger } from '../logger.js'
import type { EntryType } from '../extract/extractor.js'
import { parseLooseJson } from '../extract/extractor.js'
import {
  DAY_MS,
  addLocalDays,
  formatDateTime,
  getLocalTimezone,
  isoWeekday,
  parseIsoTime,
  startOfLocalDay,
} from '../extract/timeParse.js'

export interface TimeWindow {
  start: number
  end: number
}

export interface QueryUnderstanding {
  needsPersonalContext: boolean
  timeRange: TimeWindow | null
  keywords: string[]
  entityTypes: EntryType[]
  /** 结果来自模型还是规则降级 */
  source: 'llm' | 'rules'
}

export interface UnderstandOptions {
  query: string
  now?: number
  timezone?: string
  /** 测试注入；默认走 createChatChain */
  invoke?: (messages: ChatMessage[]) => Promise<string>
  timeoutMs?: number
}

const ALL_TYPES: EntryType[] = ['schedule', 'plan', 'fact', 'note']

const PERSONAL_CUE =
  /我|咱|最近|近[0-9一二三四五六七八九十两]+[天日]|今天|今日|明天|后天|这周|本周|上周|下周|这个月|本月|上个月|上月|安排|日程|计划|提醒|记得|记录/
const GENERIC_QUESTION = /^(什么是|什么叫|啥是|介绍一下|解释一下|解释下|如何|怎么|为什么|有哪些)/

const CN_NUMBER: Record<string, number> = {
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

const parseCount = (raw: string): number | null => {
  if (/^\d+$/.test(raw)) return Number(raw)
  if (raw === '十') return 10
  if (raw.startsWith('十')) return 10 + (CN_NUMBER[raw.slice(1)] ?? 0)
  if (raw.endsWith('十')) return (CN_NUMBER[raw[0]] ?? 0) * 10
  if (raw.length === 2 && CN_NUMBER[raw[0]] && CN_NUMBER[raw[1]]) {
    return CN_NUMBER[raw[0]] * 10 + CN_NUMBER[raw[1]]
  }
  return CN_NUMBER[raw] ?? null
}

const startOfMonth = (ms: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

const addLocalMonths = (ms: number, months: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate()).getTime()
}

/** 本周一 00:00（ISO 周一为一周起点） */
const startOfWeek = (ms: number): number => addLocalDays(startOfLocalDay(ms), -(isoWeekday(ms) - 1))

/** 规则版时间窗口识别（不依赖模型） */
export const detectTimeWindow = (query: string, nowMs: number): TimeWindow | null => {
  const today = startOfLocalDay(nowMs)

  const recent = /(?:最近|近|过去)\s*([0-9一二三四五六七八九十两]+)\s*[天日]/.exec(query)
  if (recent) {
    const n = parseCount(recent[1])
    if (n && n > 0) {
      return { start: addLocalDays(today, -(n - 1)), end: addLocalDays(today, 1) }
    }
  }

  if (/上个月|上月/.test(query)) {
    return { start: addLocalMonths(startOfMonth(nowMs), -1), end: startOfMonth(nowMs) }
  }
  if (/这个月|本月|这月/.test(query)) {
    return { start: startOfMonth(nowMs), end: addLocalMonths(startOfMonth(nowMs), 1) }
  }

  const week = startOfWeek(nowMs)
  if (/上周|上个星期|上星期/.test(query)) {
    return { start: addLocalDays(week, -7), end: week }
  }
  if (/下周|下个星期|下星期/.test(query)) {
    return { start: addLocalDays(week, 7), end: addLocalDays(week, 14) }
  }
  if (/这周|本周|这个星期|这一周/.test(query)) {
    return { start: week, end: addLocalDays(week, 7) }
  }

  if (/大后天/.test(query)) return { start: addLocalDays(today, 3), end: addLocalDays(today, 4) }
  if (/后天/.test(query)) return { start: addLocalDays(today, 2), end: addLocalDays(today, 3) }
  if (/明天|明日/.test(query)) return { start: addLocalDays(today, 1), end: addLocalDays(today, 2) }
  if (/今天|今日/.test(query)) return { start: today, end: addLocalDays(today, 1) }

  return null
}

/** 规则版降级：时间窗口 + 个人上下文判定 */
export const ruleBasedUnderstanding = (query: string, nowMs: number): QueryUnderstanding => {
  const timeRange = detectTimeWindow(query, nowMs)
  const hasCue = PERSONAL_CUE.test(query)
  const needsPersonalContext = hasCue || timeRange !== null || !GENERIC_QUESTION.test(query)

  return {
    needsPersonalContext,
    timeRange,
    keywords: [],
    entityTypes: ALL_TYPES,
    source: 'rules',
  }
}

const buildMessages = (query: string, nowMs: number, timezone: string): ChatMessage[] => [
  {
    role: 'system',
    content: `你是检索助手。把用户的问题解析成 JSON，只输出 JSON 对象，不要解释、不要代码围栏。
当前时间：${formatDateTime(nowMs, timezone)}，时区：${timezone}

输出格式：
{"needsPersonalContext": true, "timeRange": {"start": "2026-11-09 00:00", "end": "2026-11-16 00:00"}, "keywords": ["关键词"], "entityTypes": ["schedule","plan","fact","note"]}

规则：
- 通用知识问题（如"什么是闭包"）→ needsPersonalContext 为 false；含"我/我的/最近/这周"等个人线索 → true
- 只有问题带明确时间语义时才给 timeRange；end 取窗口右端点（不包含）
- entityTypes 只能从 schedule/plan/fact/note 中选，不确定就全给
- keywords 给 1-5 个检索关键词`,
  },
  { role: 'user', content: query },
]

const asStringArray = (value: unknown, max: number, maxLen: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim().slice(0, maxLen))
        .slice(0, max)
    : []

const normalizeLlmUnderstanding = (
  payload: unknown,
  fallback: QueryUnderstanding,
): QueryUnderstanding | null => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const raw = payload as Record<string, unknown>

  const range = raw.timeRange
  let timeRange: TimeWindow | null = null
  if (range !== null && range !== undefined && typeof range === 'object' && !Array.isArray(range)) {
    const r = range as Record<string, unknown>
    const start = parseIsoTime(r.start)
    const end = parseIsoTime(r.end)
    if (start !== null && end !== null && end > start) timeRange = { start, end }
  }

  const types = asStringArray(raw.entityTypes, 4, 16).filter((v): v is EntryType =>
    (ALL_TYPES as string[]).includes(v),
  )

  return {
    needsPersonalContext:
      typeof raw.needsPersonalContext === 'boolean'
        ? raw.needsPersonalContext
        : fallback.needsPersonalContext,
    // 模型没给窗口时，规则能识别的窗口仍然有效
    timeRange: timeRange ?? fallback.timeRange,
    keywords: asStringArray(raw.keywords, 5, 20),
    entityTypes: types.length > 0 ? types : ALL_TYPES,
    source: 'llm',
  }
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('understand timeout')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })

const defaultInvoke = async (messages: ChatMessage[]): Promise<string> => {
  const chain = createChatChain({ temperature: 0, feature: 'rag' })
  const response = await chain.invoke({ messages })
  return response.content
}

/** 查询理解主入口：LLM 优先，失败降级规则 */
export const understandQuery = async (options: UnderstandOptions): Promise<QueryUnderstanding> => {
  const nowMs = options.now ?? Date.now()
  const timezone = options.timezone ?? getLocalTimezone()
  const invoke = options.invoke ?? defaultInvoke
  const timeoutMs = options.timeoutMs ?? 8000
  const fallback = ruleBasedUnderstanding(options.query, nowMs)

  try {
    const content = await withTimeout(
      invoke(buildMessages(options.query, nowMs, timezone)),
      timeoutMs,
    )
    const parsed = normalizeLlmUnderstanding(parseLooseJson(content), fallback)
    if (!parsed) {
      logger.warn('search.understanding', '查询理解输出非法，已降级为规则解析')
      return fallback
    }
    return parsed
  } catch (err) {
    logger.warn('search.understanding', '查询理解调用失败，已降级为规则解析', {
      error: (err as Error).message,
    })
    return fallback
  }
}

/** 无时间语义时的默认窗口：最近 N 天（供提醒/调试使用） */
export const defaultRecentWindow = (nowMs: number, days = 30): TimeWindow => ({
  start: addLocalDays(startOfLocalDay(nowMs), -(days - 1)),
  end: addLocalDays(startOfLocalDay(nowMs), 1),
})

export const searchWindowDays = (window: TimeWindow): number =>
  Math.max(1, Math.round((window.end - window.start) / DAY_MS))
