/**
 * 后端接口封装 — 对话页与记忆页共用
 *
 * 统一拼接 bffUrl、序列化 JSON、把错误体转成可读文案。
 * 调用方只需关心返回类型与 catch 提示。
 */

interface ApiErrorBody {
  error?: { message?: string }
  message?: string
}

const baseUrl = (): string => {
  const config = useRuntimeConfig()
  return String(config.public.bffUrl ?? '').replace(/\/$/, '')
}

export const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as ApiErrorBody
      message = body?.error?.message ?? body?.message ?? message
    } catch {
      /* 非 JSON 错误体，保留默认文案 */
    }
    throw new Error(message)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const apiGet = <T>(path: string): Promise<T> => apiFetch<T>(path)

export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const apiPatch = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

export const apiDelete = (path: string): Promise<void> => apiFetch<void>(path, { method: 'DELETE' })

/** multipart 上传（不手写 Content-Type，交给浏览器生成 boundary） */
export const apiUpload = async <T>(path: string, form: FormData): Promise<T> => {
  const res = await fetch(`${baseUrl()}${path}`, { method: 'POST', body: form })
  if (!res.ok) {
    let message = `上传失败（${res.status}）`
    try {
      const body = (await res.json()) as ApiErrorBody
      message = body?.error?.message ?? body?.message ?? message
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export interface DocumentRow {
  id: string
  name: string
  size: number
  status: 'ready' | 'processing' | 'failed'
  chunk_count: number
  created_at: number
}

// ── 对话相关类型（与 server 端响应形状一致） ──────────

export type EntryType = 'schedule' | 'plan' | 'fact' | 'note'
export type EntryStatus = 'draft' | 'active' | 'done' | 'archived'

export interface CitationEntry {
  num: number
  type: 'entry'
  id: string
  entryType: EntryType
  label: string
  snippet: string
  startAt: number | null
  endAt: number | null
  occurrence: boolean
}

export interface CitationChunk {
  num: number
  type: 'chunk'
  id: string
  docId: string
  docName: string
  chunkIndex: number
  snippet: string
}

export interface CitationSummary {
  num: number
  type: 'summary'
  text: string
  remaining: number
  byType: Partial<Record<EntryType, number>>
  docChunks: number
}

export type Citation = CitationEntry | CitationChunk | CitationSummary

export interface ChatAnswer {
  ok: boolean
  reply: string
  citations: Citation[]
  missing: string[]
  degraded: boolean
  degradedReason: 'timeout' | 'llm_error' | 'not_found' | null
  empty: boolean
  general: boolean
  embeddingMock: boolean
  sessionId: string | null
  userMessageId: string | null
  assistantMessageId: string | null
}

export interface ExtractedTime {
  raw: string
  start: number
  end: number | null
  confidence: number
  startText: string
  endText: string | null
}

export interface Recurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  interval?: number
  byWeekday?: string[]
  byMonthDay?: number
  until?: number
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

export interface EntryCard extends ExtractedEntry {
  duplicate: { id?: string; title?: string; similarity?: number } | null
  conflicts: Array<{
    id?: string
    title?: string
    start: number
    end: number | null
    startText: string
    endText: string | null
  }>
}

export interface ExtractResponse {
  ok: boolean
  intent: 'record' | 'query' | 'chat'
  reply: string
  entries: EntryCard[]
  truncated: boolean
  remaining: number
  failed: Record<string, unknown> | null
  rawText: string
  source: { sessionId: string | null; libraryId: string }
}

export interface SessionSummary {
  id: string
  title: string
  model: string
  created_at: number
  updated_at: number
  message_count?: number
}

export interface SessionMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  citations: Citation[] | null
  metadata: string | Record<string, unknown> | null
  created_at: number
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[]
}

export interface CreateEntryPayload {
  type: EntryType
  title: string
  content: string
  status: EntryStatus
  startAt?: number | null
  endAt?: number | null
  recurrence?: Recurrence | null
  sourceType: 'conversation' | 'document' | 'manual'
  confidence?: number
}

export interface ReminderItem {
  id: string
  type: string
  title: string
  startAt: number
  endAt: number | null
  occurrence: boolean
}

export interface RemindersResponse {
  today: ReminderItem[]
  tomorrow: ReminderItem[]
}

export const TYPE_LABEL: Record<EntryType, string> = {
  schedule: '日程',
  plan: '规划',
  fact: '事实',
  note: '笔记',
}
