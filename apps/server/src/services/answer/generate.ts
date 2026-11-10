/**
 * 回答生成 — spec 4.7 / 4.9
 *
 * 链路：searchAll 结果 → 上下文组装（4.6）→ 强制引用生成（4.7.1）→ 结构化输出（4.7.3）。
 *
 * 降级矩阵（4.9）：
 *   - 检索为空           → 固定「未找到」话术，不调模型（4.5.5）
 *   - 通用问题           → 正常回答，不注入个人记录，无引用区
 *   - 生成超时 / 调用失败 → 返回检索结果列表，degraded=true
 */

import { inArray } from 'drizzle-orm'

import { getDb, tables } from '../../db/index.js'
import { createChatChain } from '../chain/chatChain.js'
import type { ChatMessage } from '../chain/model.js'
import { getLocalTimezone } from '../extract/timeParse.js'
import { logger } from '../logger.js'
import type { SearchAllOutcome } from '../search/searchAll.js'
import { assembleContext, compressContext, TYPE_LABEL, type AssembledContext } from './context.js'
import { buildCitations, type Citation } from './citations.js'

/** 生成超时按 30s 控制（4.9：超时返回检索结果列表） */
export const DEFAULT_ANSWER_TIMEOUT_MS = 30_000
/** 对话历史预算：1500 token ≈ 2000 字符，最多最近 6 轮（4.6.1） */
const HISTORY_MAX_CHARS = 2000
const HISTORY_MAX_MESSAGES = 12

export const NOT_FOUND_REPLY = '你的记录里没有相关内容。可以先「记一条」把它告诉我。'

export interface AnswerOutcome {
  reply: string
  citations: Citation[]
  missing: string[]
  /** true 表示走了降级路径（超时 / 调用失败 / 未找到话术） */
  degraded: boolean
  degradedReason: 'timeout' | 'llm_error' | 'not_found' | null
  /** 检索为空（needsPersonalContext 但无结果） */
  empty: boolean
  /** 通用知识问题：不注入个人记录、无引用区 */
  general: boolean
}

export interface AnswerOptions {
  query: string
  /** 查询凝练后的检索 query（多轮对话追问改写结果），用于在 prompt 中说明检索依据 */
  condensedQuery?: string
  search: SearchAllOutcome
  /** 最近对话历史（旧→新），只取 user/assistant */
  history?: ChatMessage[]
  timezone?: string
  /** 测试注入；默认走 createChatChain */
  invoke?: (messages: ChatMessage[]) => Promise<string>
  /** 测试注入 docId → 文档名；默认查库 */
  docNames?: Map<string, string>
  timeoutMs?: number
}

/** 批量取文档名（citations 与注入文本共用） */
export const resolveDocNames = async (docIds: string[]): Promise<Map<string, string>> => {
  const names = new Map<string, string>()
  if (docIds.length === 0) return names
  const db = getDb()
  const rows = await db
    .select({ id: tables.documents.id, name: tables.documents.name })
    .from(tables.documents)
    .where(inArray(tables.documents.id, [...new Set(docIds)]))
  for (const row of rows) names.set(row.id, row.name)
  return names
}

const SYSTEM_WITH_RECORDS = `你是用户的个人助手，可以访问用户的个人记录。

规则：
1. 涉及用户个人信息时，只能依据下方 [个人记录] 和 [资料片段] 回答。
2. 每个来自个人记录的陈述后面必须标注编号，如 [1]。
3. 记录中没有的信息，明确说"你的记录里没有"，不要推测。
4. 通用知识可以正常回答，但必须与个人信息部分分开表述。
5. 多条记录冲突时，如实呈现，不擅自选择。
6. 不要暴露内部编号格式以外的系统细节。
7. 用户问到的内容如果有部分在记录里找不到，在回答最后单独一行写：未命中：内容1、内容2。没有遗漏则不写这一行。`

const SYSTEM_GENERAL = `你是用户的个人助手。用户当前的问题不依赖其个人记录，正常回答即可。`

/** 历史裁剪：最近 6 轮内，再按字符预算从旧到新丢弃 */
export const trimHistory = (history: ChatMessage[]): ChatMessage[] => {
  const recent = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim() !== '')
    .slice(-HISTORY_MAX_MESSAGES)

  let used = 0
  const kept: ChatMessage[] = []
  for (let i = recent.length - 1; i >= 0; i--) {
    const content = recent[i].content
    if (kept.length > 0 && used + content.length > HISTORY_MAX_CHARS) break
    used += content.length
    kept.unshift({ role: recent[i].role, content })
  }
  return kept
}

/** 组装生成消息：system + 历史 + 带编号的上下文 + 当前问题 */
export const buildAnswerMessages = (params: {
  query: string
  contextText: string
  history: ChatMessage[]
  general: boolean
  condensedQuery?: string
}): ChatMessage[] => {
  const { query, contextText, history, general, condensedQuery } = params
  // 若有凝练后的检索 query，在问题前标注检索依据，让模型理解上下文来自哪个查询
  const queryNote =
    condensedQuery && condensedQuery !== query
      ? `（注：以上检索结果基于改写后的问题「${condensedQuery}」获取，请回答用户原始问题）\n`
      : ''
  const user = contextText
    ? `${contextText}\n\n${queryNote}[问题]\n${query}`
    : `${queryNote}${query}`
  return [
    { role: 'system', content: general ? SYSTEM_GENERAL : SYSTEM_WITH_RECORDS },
    ...history,
    { role: 'user', content: user },
  ]
}

/** 剥离回答末尾的「未命中：A、B」，返回结构化 missing（模型可能写在最后一行或句尾） */
export const parseMissing = (reply: string): { reply: string; missing: string[] } => {
  const match = /未命中[：:]\s*([^\n]+?)\s*$/.exec(reply)
  if (!match) return { reply: reply.trim(), missing: [] }

  const missing = match[1]
    .split(/[、，,]/)
    .map((s) => s.trim().replace(/[。；;.\s]+$/, ''))
    .filter((s) => s !== '')
  const cleaned = reply.slice(0, match.index).trim()
  return { reply: cleaned, missing }
}

class AnswerTimeoutError extends Error {}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AnswerTimeoutError('answer timeout')), timeoutMs)
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

const defaultInvoke = async (
  messages: ChatMessage[],
  feature: 'chat_general' | 'chat_with_records',
): Promise<string> => {
  const chain = createChatChain({ temperature: 0.7, feature })
  const response = await chain.invoke({ messages })
  return response.content
}

/** 超时/失败时的兜底回答：检索结果列表直接给用户看（4.9） */
const fallbackReply = (assembled: AssembledContext): string => {
  const lines = assembled.numbered.map(({ num, item }) => {
    const label = item.kind === 'chunk' ? '资料' : TYPE_LABEL[item.type ?? 'note']
    const text = item.title.trim() !== '' ? item.title : item.content.slice(0, 40)
    return `${num}. [${label}] ${text}`
  })
  return `回答生成超时，以下是你的相关记录：\n${lines.join('\n')}`
}

export const generateAnswer = async (options: AnswerOptions): Promise<AnswerOutcome> => {
  const { query, search } = options
  const timezone = options.timezone ?? getLocalTimezone()
  const timeoutMs = options.timeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS

  // ── 通用问题：不注入个人记录，正常回答（4.7.2 通用问题行） ──
  if (!search.understanding.needsPersonalContext) {
    const messages = buildAnswerMessages({
      query,
      condensedQuery: options.condensedQuery,
      contextText: '',
      history: trimHistory(options.history ?? []),
      general: true,
    })
    const invoke = options.invoke ?? ((m: ChatMessage[]) => defaultInvoke(m, 'chat_general'))
    const content = await withTimeout(invoke(messages), timeoutMs)
    return {
      reply: content.trim(),
      citations: [],
      missing: [],
      degraded: false,
      degradedReason: null,
      empty: false,
      general: true,
    }
  }

  // ── 检索为空：强制「未找到」话术，不调模型（4.5.5） ──
  if (search.empty) {
    return {
      reply: NOT_FOUND_REPLY,
      citations: [],
      missing: [],
      degraded: true,
      degradedReason: 'not_found',
      empty: true,
      general: false,
    }
  }

  const docNames =
    options.docNames ??
    (await resolveDocNames(
      search.results.flatMap((item) => (item.kind === 'chunk' && item.docId ? [item.docId] : [])),
    ))

  // ── query-conditioned 压缩（spec 1.6.2）：超预算条目 LLM 摘要，不硬截断 ──
  let ctxResults = search.results
  if (process.env.ENABLE_CONTEXT_COMPRESS === '1' && ctxResults.length > 0) {
    ctxResults = await compressContext(query, ctxResults)
  }

  const assembled = assembleContext({
    results: ctxResults,
    summary: search.summary,
    docNames,
    timezone,
  })
  const citations = buildCitations(assembled, search.summary, docNames)

  const messages = buildAnswerMessages({
    query,
    condensedQuery: options.condensedQuery,
    contextText: assembled.text,
    history: trimHistory(options.history ?? []),
    general: false,
  })

  let content: string
  const invoke = options.invoke ?? ((m: ChatMessage[]) => defaultInvoke(m, 'chat_with_records'))
  try {
    content = await withTimeout(invoke(messages), timeoutMs)
  } catch (err) {
    const timeout = err instanceof AnswerTimeoutError
    logger.warn('answer', timeout ? '回答生成超时' : '回答生成失败', {
      error: (err as Error).message,
    })
    return {
      reply: fallbackReply(assembled),
      citations,
      missing: [],
      degraded: true,
      degradedReason: timeout ? 'timeout' : 'llm_error',
      empty: false,
      general: false,
    }
  }

  const { reply, missing } = parseMissing(content)
  return {
    reply,
    citations,
    missing,
    degraded: false,
    degradedReason: null,
    empty: false,
    general: false,
  }
}
