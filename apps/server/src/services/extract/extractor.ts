/**
 * 抽取链路 — LLM 意图判别 + 结构化抽取（spec 4.3）
 *
 * 设计要点：
 *   - 意图判别与抽取合并为一次调用（4.3.1），不额外分类
 *   - 输出严格 JSON，非 JSON 重试一次（4.3.6）
 *   - 代码侧做时间校验与重复规则规范化（4.3.3 / 4.3.7）
 *   - 模型调用通过 invoke 注入，便于单测不依赖真实 LLM
 */

import { createChatChain } from '../chain/chatChain.js'
import type { ChatMessage } from '../chain/model.js'
import { logger } from '../logger.js'
import {
  firstRecurrenceDay,
  formatDateTime,
  formatRecurrenceText,
  getLocalTimezone,
  parseIsoTime,
  parseRelativeTime,
  parseStatedWeekday,
  validateTimeRange,
  weekdayFromMs,
  type RelativeRecurrence,
} from './timeParse.js'
import { alignRecurrenceStart, normalizeRecurrence, type Recurrence } from './recurrence.js'

export type EntryType = 'schedule' | 'plan' | 'fact' | 'note'
export type Intent = 'record' | 'query' | 'chat'
export type ExtractFailure = 'non_json' | 'timeout' | 'llm_error' | null

/** 单次最多展示 5 条（spec 4.3.6） */
export const MAX_EXTRACT_ENTRIES = 5
/** 抽取调用超时（spec 4.3.6：15s） */
export const DEFAULT_EXTRACT_TIMEOUT_MS = 15_000

export interface ExtractedTime {
  raw: string
  start: number
  end: number | null
  confidence: number
  startText: string
  endText: string | null
}

export interface ExtractedEntry {
  type: EntryType
  title: string
  content: string
  time: ExtractedTime | null
  recurrence: Recurrence | null
  recurrenceText: string | null
  confidence: number
  needsReview: boolean
  duplicateHint: string | null
  warnings: string[]
}

export interface ExtractOutcome {
  ok: boolean
  intent: Intent
  reply: string
  entries: ExtractedEntry[]
  truncated: boolean
  remaining: number
  failed: ExtractFailure
  /** 原文保留，抽取失败时供前端「手动新建」 */
  rawText: string
}

/** 注入 Prompt 的已有记录（最多 5 条） */
export interface PromptEntry {
  type: string
  title: string
  content: string
  timeText?: string
}

export interface ExtractOptions {
  text: string
  /** conversation：对话录入；document：文档节选（阶段 5） */
  mode?: 'conversation' | 'document'
  now?: number
  timezone?: string
  existingEntries?: PromptEntry[]
  /** 单次最多返回条数：对话 5，文档 10 */
  maxEntries?: number
  /** 测试注入；默认走 createChatChain */
  invoke?: (messages: ChatMessage[]) => Promise<string>
  timeoutMs?: number
}

// ─────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────

const OUTPUT_SCHEMA = `{
  "intent": "record | query | chat",
  "entries": [
    {
      "type": "schedule | plan | fact | note",
      "title": "不超过 30 字的标题",
      "content": "完整描述，保留原始细节",
      "time": {
        "raw": "原文中的时间表达",
        "start": "2026-11-11T14:00:00+08:00",
        "end": "2026-11-11T15:00:00+08:00",
        "confidence": 0.92
      },
      "recurrence": {
        "freq": "DAILY | WEEKLY | MONTHLY",
        "interval": 1,
        "byWeekday": ["MO"],
        "byMonthDay": 5,
        "until": "2027-11-06T00:00:00+08:00"
      },
      "confidence": 0.9,
      "duplicateHint": "可能与已有记录重复时的说明，否则为 null"
    }
  ],
  "reply": "给用户的自然语言反馈"
}`

const SECURITY_RULES = `规则：
1. 只提取与用户本人相关的事实、日程、规划。
2. 时间必须转换为带时区的 ISO 8601；无法确定就不填。
3. 一条话包含多个事件时拆成多条。
4. 不要编造用户没说的信息。
5. 只输出 JSON，不要附加解释，不要使用 Markdown 代码围栏。
6. 重复规则只支持：DAILY（可带 interval）、WEEKLY（可带 byWeekday）、MONTHLY（可带 byMonthDay）。
   其他重复方式（每年、每月第 N 个周几等）请按单次事件输出，并在 content 里说明。
7. 时间无法解析时 time 为 null，此时 type 不能是 schedule。
8. intent 判别：疑问句 → query；纯寒暄 → chat；含时间/自我描述/未来意图 → record；
   同时含提问与陈述时 intent 用 record，并在 reply 中回答用户的问题。
9. 句中出现「什么 / 怎么 / 为什么 / 哪些 / 哪个 / 多少 / 如何 / 是否 / 有没有」等疑问词时，
   即使句子里带「我」，也判为 query，不要抽取成条目。`

/** 组装抽取 Prompt（spec 4.3.5） */
export const buildExtractMessages = (params: {
  text: string
  nowMs: number
  timezone: string
  mode?: 'conversation' | 'document'
  existingEntries?: PromptEntry[]
}): ChatMessage[] => {
  const { text, nowMs, timezone, mode = 'conversation', existingEntries = [] } = params

  const existing =
    existingEntries.length > 0
      ? existingEntries
          .map((e) => {
            const time = e.timeText ? `（${e.timeText}）` : ''
            const content = e.content ? `：${e.content.slice(0, 120)}` : ''
            return `- [${e.type}] ${e.title}${time}${content}`
          })
          .join('\n')
      : '（无）'

  const intro =
    mode === 'document'
      ? `你是个人记忆助手。从文档内容里提取值得长期记住的信息（忽略目录、页眉页脚等噪音）。`
      : '你是个人记忆助手。从用户的话里提取需要长期记住的信息。'

  const system = `${intro}

当前时间：${formatDateTime(nowMs, timezone)}，时区：${timezone}
已有相关记录（用于判重，仅供参考）：
${existing}

${SECURITY_RULES}

输出结构：
${OUTPUT_SCHEMA}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ]
}

// ─────────────────────────────────────────────
// 响应解析与字段补齐
// ─────────────────────────────────────────────

const ENTRY_TYPES: EntryType[] = ['schedule', 'plan', 'fact', 'note']
const INTENTS: Intent[] = ['record', 'query', 'chat']

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asString = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return null
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 校正开始时间时，结束时间同步平移，保持原时长 */
const shiftEnd = (oldStart: number, newStart: number, end: number | null): number | null =>
  end === null ? null : end + (newStart - oldStart)

/** 去掉 ```json 围栏，并尽量从混杂文本中截出第一个 JSON 对象 */
export const parseLooseJson = (content: string): unknown => {
  let text = content.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  if (fence) text = fence[1].trim()

  try {
    return JSON.parse(text)
  } catch {
    /* 落到底部再截取 */
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

const deriveTitle = (content: string): string => {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (!clean) return '未命名记录'
  return clean.length > 30 ? `${clean.slice(0, 30)}…` : clean
}

const normalizeEntry = (raw: unknown, nowMs: number, sourceText: string): ExtractedEntry | null => {
  const record = asRecord(raw)
  if (!record) return null

  const content = asString(record.content)?.trim() ?? ''
  const rawTitle = asString(record.title)?.trim() ?? ''
  const rawType = asString(record.type)?.trim()
  if (!rawTitle && !content) return null

  try {
    return buildEntry(record, rawTitle, content, rawType, nowMs, sourceText)
  } catch (err) {
    logger.warn('extract', '条目规范化失败，已跳过', { error: (err as Error).message })
    return null
  }
}

function buildEntry(
  record: Record<string, unknown>,
  rawTitle: string,
  content: string,
  rawType: string | undefined,
  nowMs: number,
  sourceText: string,
): ExtractedEntry {
  const warnings: string[] = []
  let missingField = false
  const title = rawTitle || deriveTitle(content)
  if (!rawTitle) missingField = true

  let type: EntryType = 'note'
  if (rawType && (ENTRY_TYPES as string[]).includes(rawType)) {
    type = rawType as EntryType
  } else {
    missingField = true
    if (rawType) warnings.push('类型无法识别，已按笔记处理')
  }

  let confidence = asNumber(record.confidence)
  if (confidence === null) {
    missingField = true
    confidence = missingField ? 0.3 : 0.5
  }
  confidence = clamp01(confidence)
  if (missingField) {
    confidence = Math.min(confidence, 0.3)
    warnings.push('字段不完整，请核对')
  }

  // ── 时间 ────────────────────────────────
  const timeRecord = asRecord(record.time)
  const rawTimeText = asString(timeRecord?.raw)?.trim() ?? ''
  let start = parseIsoTime(timeRecord?.start)
  let end = parseIsoTime(timeRecord?.end)
  let timeConfidence = asNumber(timeRecord?.confidence)

  if (timeRecord && timeRecord.start !== undefined && timeRecord.start !== null && start === null) {
    warnings.push('开始时间格式无法识别')
  }
  if (timeRecord && timeRecord.end !== undefined && timeRecord.end !== null && end === null) {
    warnings.push('结束时间格式无法识别，已忽略结束时间')
  }

  // 模型没给出可用开始时间时，用原文相对时间兜底
  let fallbackRecurrence: RelativeRecurrence | null = null
  if (start === null && rawTimeText) {
    const relative = parseRelativeTime(rawTimeText, nowMs)
    if (relative && relative.start !== null) {
      start = relative.start
      end = relative.end ?? end
      fallbackRecurrence = relative.recurrence
      if (timeConfidence === null) timeConfidence = relative.confidence
      warnings.push(...relative.warnings)
    }
  }

  // 原文明确写了星期时，校验模型给的日期是否对得上（模型偶尔会错一天）
  const statedWeekday = rawTimeText ? parseStatedWeekday(rawTimeText) : null
  if (start !== null && statedWeekday && weekdayFromMs(start) !== statedWeekday) {
    const relative = parseRelativeTime(rawTimeText, nowMs)
    if (relative && relative.start !== null) {
      end = shiftEnd(start, relative.start, end)
      start = relative.start
      fallbackRecurrence = relative.recurrence ?? fallbackRecurrence
      warnings.push('时间与原文不一致，已按原文校正')
    }
  }

  // ── 重复规则 ────────────────────────────
  // 原文没有「每 / 隔 N 天」等重复线索时，不采纳模型臆测出来的重复规则
  const recurrenceCue = /每|隔\s*[一二两三四五六七八九十\d]/.test(`${sourceText} ${rawTimeText}`)
  let recurrenceInput: unknown = record.recurrence ?? fallbackRecurrence
  if (record.recurrence && !recurrenceCue) {
    recurrenceInput = fallbackRecurrence
    warnings.push('原文未表达重复，已按单次事件处理')
  }

  const normalizedRecurrence = normalizeRecurrence(recurrenceInput, nowMs, start)
  warnings.push(...normalizedRecurrence.warnings)
  const recurrence = normalizedRecurrence.recurrence

  if (start === null && recurrence) {
    start = firstRecurrenceDay(recurrence, nowMs)
    warnings.push('未指定具体时间，已按该日 00:00 计算')
  }

  // 重复事件的开始时间必须是规则的一次发生
  if (start !== null && recurrence) {
    const aligned = alignRecurrenceStart(start, recurrence, nowMs)
    if (aligned !== null && aligned !== start) {
      end = shiftEnd(start, aligned, end)
      start = aligned
      warnings.push('开始时间与重复规则不一致，已对齐到下一次')
    }
  }

  // ── 时间校验（过去 / 起止颠倒） ──────────
  const validated = validateTimeRange(start, end, nowMs, { recurring: recurrence !== null })
  start = validated.start
  end = validated.end
  warnings.push(...validated.warnings)

  if (type === 'schedule' && start === null) {
    type = 'plan'
    warnings.push('没有解析到具体时间，已降级为计划')
  }

  const time: ExtractedTime | null =
    start !== null
      ? {
          raw: rawTimeText || formatDateTime(start),
          start,
          end,
          confidence: clamp01(timeConfidence ?? confidence),
          startText: formatDateTime(start),
          endText: end !== null ? formatDateTime(end) : null,
        }
      : null

  const recurrenceText = recurrence ? formatRecurrenceText(recurrence, start) : null

  const duplicateHint = asString(record.duplicateHint)?.trim() || null

  // 只有「不确定」类提醒才需要用户核对；确定性的校正（如按原文对齐时间）不打扰用户
  const reviewHints = [
    '不完整',
    '已过去',
    '未指定具体时间',
    '未说明日期',
    '不够精确',
    '不确定',
    '无法识别',
    '降级',
    '暂不支持',
  ]
  const needsReview =
    confidence < 0.6 ||
    warnings.some((warning) => reviewHints.some((hint) => warning.includes(hint)))

  return {
    type,
    title,
    content,
    time,
    recurrence,
    recurrenceText,
    confidence,
    needsReview,
    duplicateHint,
    warnings,
  }
}

/** 把模型 JSON 响应规范化为可展示条目 */
export const normalizeExtractResponse = (
  payload: unknown,
  nowMs: number,
  sourceText = '',
): { intent: Intent; reply: string; entries: ExtractedEntry[] } | null => {
  const record = asRecord(payload)
  if (!record) return null

  const rawEntries = Array.isArray(record.entries) ? record.entries : []
  const entries = rawEntries
    .map((item) => normalizeEntry(item, nowMs, sourceText))
    .filter((item): item is ExtractedEntry => item !== null)

  const rawIntent = asString(record.intent)?.trim()
  let intent: Intent = (INTENTS as string[]).includes(rawIntent ?? '')
    ? (rawIntent as Intent)
    : 'chat'
  // 有抽取结果时，intent 一律视为录入（4.3.1：先抽取再回答）
  if (entries.length > 0) intent = 'record'

  const reply =
    asString(record.reply)?.trim() ||
    (entries.length > 0
      ? `已整理出 ${entries.length} 条记录，请核对后确认。`
      : '没有需要记录的内容。')

  return { intent, reply, entries }
}

// ─────────────────────────────────────────────
// 调用编排
// ─────────────────────────────────────────────

class ExtractTimeoutError extends Error {}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExtractTimeoutError('extract timeout')), timeoutMs)
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
  const chain = createChatChain({ temperature: 0.1, feature: 'extract' })
  const response = await chain.invoke({ messages })
  return response.content
}

const retryMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const last = messages[messages.length - 1]
  return [
    ...messages.slice(0, -1),
    {
      role: last.role,
      content: `${last.content}\n\n（注意：上一次输出不是合法 JSON。请只输出 JSON 对象，不要解释，不要代码围栏。）`,
    },
  ]
}

const failureOutcome = (text: string, failed: ExtractFailure): ExtractOutcome => {
  const reply =
    failed === 'timeout'
      ? '整理超时了，已保留你的原文，可以手动新建或稍后重试。'
      : failed === 'llm_error'
        ? '整理失败，已保留你的原文，可以手动新建或稍后重试。'
        : '没能整理成记录，已保留你的原文，可以手动新建。'

  return {
    ok: false,
    intent: 'chat',
    reply,
    entries: [],
    truncated: false,
    remaining: 0,
    failed,
    rawText: text,
  }
}

/** 抽取主入口：意图判别 + 结构化抽取（一次调用） */
export const extractEntries = async (options: ExtractOptions): Promise<ExtractOutcome> => {
  const { text } = options
  const nowMs = options.now ?? Date.now()
  const timezone = options.timezone ?? getLocalTimezone()
  const invoke = options.invoke ?? defaultInvoke
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS

  const messages = buildExtractMessages({
    text,
    nowMs,
    timezone,
    mode: options.mode,
    existingEntries: options.existingEntries,
  })
  const maxEntries = options.maxEntries ?? MAX_EXTRACT_ENTRIES

  let lastFailure: ExtractFailure = 'non_json'

  for (let attempt = 0; attempt < 2; attempt++) {
    const requestMessages = attempt === 0 ? messages : retryMessages(messages)

    let content: string
    try {
      content = await withTimeout(invoke(requestMessages), timeoutMs)
    } catch (err) {
      const timeout = err instanceof ExtractTimeoutError
      lastFailure = timeout ? 'timeout' : 'llm_error'
      logger.warn('extract', timeout ? '抽取调用超时' : '抽取调用失败', {
        attempt: attempt + 1,
        error: (err as Error).message,
      })
      // 超时不再重试，直接降级（4.3.6）
      if (timeout) break
      continue
    }

    const payload = parseLooseJson(content)
    const normalized = payload === null ? null : normalizeExtractResponse(payload, nowMs, text)

    if (!normalized) {
      lastFailure = 'non_json'
      logger.warn('extract', '模型输出不是合法 JSON', { attempt: attempt + 1 })
      continue
    }

    const total = normalized.entries.length
    const entries = normalized.entries.slice(0, maxEntries)

    return {
      ok: true,
      intent: normalized.intent,
      reply: normalized.reply,
      entries,
      truncated: total > maxEntries,
      remaining: Math.max(0, total - maxEntries),
      failed: null,
      rawText: text,
    }
  }

  return failureOutcome(text, lastFailure)
}
