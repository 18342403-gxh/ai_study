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

/** SSR 时把浏览器 Cookie 透传给 BFF，保证首屏请求也带登录态 */
const ssrCookie = (): string | undefined => {
  if (!import.meta.server) return undefined
  try {
    return useRequestHeaders(['cookie']).cookie
  } catch {
    return undefined
  }
}

const authHeaders = (): Record<string, string> => {
  const cookie = ssrCookie()
  return cookie ? { cookie } : {}
}

/** 登录态接口的 401 由调用方处理；业务接口 401 直接回登录页 */
const handleUnauthorized = (path: string): void => {
  if (import.meta.client && !path.startsWith('/api/auth/')) void navigateTo('/login')
}

export const apiFetch = async <T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> => {
  const { timeoutMs, ...rest } = init ?? {}
  let res: Response
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...rest,
      credentials: 'include',
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      headers: {
        ...authHeaders(),
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
    })
  } catch (err) {
    // AbortSignal.timeout 触发时 fetch 抛 TimeoutError，转成可读文案
    if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
      throw new Error('请求超时，请稍后重试', { cause: err })
    }
    throw err
  }

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path)
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

export const apiPost = <T>(path: string, body: unknown, timeoutMs?: number): Promise<T> =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body), timeoutMs })

export const apiPatch = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

export const apiDelete = (path: string): Promise<void> => apiFetch<void>(path, { method: 'DELETE' })

/** multipart 上传（不手写 Content-Type，交给浏览器生成 boundary） */
export const apiUpload = async <T>(path: string, form: FormData): Promise<T> => {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    body: form,
    credentials: 'include',
    headers: authHeaders(),
  })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path)
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

export type AuthRole = 'admin' | 'temp'

export interface AuthUser {
  id: string
  username: string
  role: AuthRole
  libraryId: string
  /** 毫秒时间戳；超管为 null */
  expiresAt: number | null
}

export interface AuthMeResponse {
  user: AuthUser
}

export interface TempAccountRow {
  id: string
  username: string
  libraryId: string
  createdAt: number
  expiresAt: number | null
  remainingMs: number | null
  lastLoginAt: number | null
}

export interface CreatedTempAccount {
  id: string
  username: string
  password: string
  libraryId: string
  expiresAt: number
}

export interface DocumentRow {
  id: string
  name: string
  size: number
  status: 'ready' | 'processing' | 'failed'
  /** 真实解析格式（pdf/docx/doc/txt/md/json），失败时可能为空 */
  kind?: string | null
  /** 失败原因，供前端直接展示 */
  error?: string | null
  error_code?: string | null
  /** 解析提示（编码回退、扩展名不一致、疑为扫描件等） */
  warnings?: string[]
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

export type DuplicateLevel = 'exact' | 'similar' | 'related'
/** skip=已存在无需操作；merge=更新已有；create=仍新建（仅提示） */
export type DuplicateAction = 'skip' | 'merge' | 'create'

export interface DuplicateInfo {
  entryId: string
  title: string
  similarity: number
  level: DuplicateLevel
  action: DuplicateAction
  reason: string
}

export interface EntryCard extends ExtractedEntry {
  /** 图模式下草稿卡片的稳定标识（resume 时回传） */
  key?: string
  duplicate: DuplicateInfo | null
  conflicts: Array<{
    entryId?: string
    title?: string
    start: number
    end: number | null
    startText: string
    endText: string | null
  }>
}

export interface ExtractResponse {
  ok: boolean
  intent: 'record' | 'query' | 'chat' | 'cancel' | 'delete' | 'update'
  reply: string
  entries: EntryCard[]
  truncated: boolean
  remaining: number
  failed: Record<string, unknown> | null
  rawText: string
  draftEntryId: string | null
  /** 图模式：草稿 id 与 thread id（中断时返回） */
  draftId?: string | null
  threadId?: string | null
  interrupted?: boolean
  cards?: EntryCard[]
  source: { sessionId: string | null; libraryId: string }
}

export interface ExtractDraftResponse {
  ok: boolean
  draftId: string
  threadId: string
  interrupted: boolean
  cards: EntryCard[]
  source: { sessionId: string | null; libraryId: string }
}

export interface ExtractResumeResponse extends ExtractDraftResponse {
  reply: string
  committed: { created: number; merged: number; skipped: number }
  done: boolean
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
  /** 创建端兜底判重策略，默认 merge；force 强制新建；error 重复时返回 409 */
  onDuplicate?: 'merge' | 'force' | 'error'
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

export interface EntryRow {
  id: string
  userId: string
  libraryId: string
  type: EntryType
  title: string
  content: string
  status: EntryStatus
  startAt: number | null
  endAt: number | null
  recurrence: Recurrence | null
  recurrenceUntil: number | null
  exceptions: unknown
  sourceType: 'conversation' | 'document' | 'manual'
  sourceRef: string | null
  confidence: number
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export const TYPE_LABEL: Record<EntryType, string> = {
  schedule: '日程',
  plan: '规划',
  fact: '事实',
  note: '笔记',
}

// ── 长期规划 ─────────────────────────────────────────

export type PlanStatus = 'draft' | 'active' | 'done' | 'archived'

export interface PlanStage {
  id?: string
  title: string
  description?: string
  targetAt?: number | null
  done?: boolean
}

export interface PlanSource {
  type: 'entry' | 'chunk'
  id: string
  label: string
  snippet: string
}

export interface PlanDraft {
  title: string
  goal: string
  startAt: number | null
  endAt: number | null
  stages: PlanStage[]
  sources: PlanSource[]
  /** false 表示知识库未覆盖，草稿为通用建议 */
  grounded: boolean
}

export interface PlanRow {
  id: string
  userId: string
  libraryId: string
  title: string
  goal: string
  status: PlanStatus
  startAt: number | null
  endAt: number | null
  progress: number
  stages: PlanStage[]
  sourceType: 'conversation' | 'document' | 'manual'
  sourceRef: string | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface PlanStepResponse {
  ok: boolean
  threadId: string
  draftId: string
  stage: 'ask' | 'confirm' | 'done'
  questions?: string[]
  draft?: PlanDraft | null
  savedPlan?: PlanRow | null
  done: boolean
}

export interface PlanCapabilities {
  aiEnabled: boolean
}

export interface PlanFormValue {
  title: string
  goal: string
  startAt: number | null
  endAt: number | null
  progress: number
  stages: PlanStage[]
}
