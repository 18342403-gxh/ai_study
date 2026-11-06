/**
 * 个人条目（记忆）类型 — v5 核心领域模型
 * 与 apps/server/src/routes/entries.ts 的 API 形状保持一致（camelCase）
 */

export type EntryType = 'schedule' | 'plan' | 'fact' | 'note'

export type EntryStatus = 'draft' | 'active' | 'done' | 'archived'

export type EntrySourceType = 'conversation' | 'document' | 'manual'

export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

/**
 * RRULE 子集（Q2：只存规则不物化实例，检索时按窗口展开）
 * - DAILY   → 只用 interval
 * - WEEKLY  → 用 byWeekday
 * - MONTHLY → 用 byMonthDay
 */
export interface RecurrenceRule {
  freq: RecurrenceFreq
  interval?: number
  byWeekday?: Weekday[]
  byMonthDay?: number
  /** 重复结束时间（毫秒时间戳） */
  until?: number
}

export interface Entry {
  id: string
  /** 为登录预留，本期固定 'local' */
  userId: string
  /** 为多库预留，本期固定 'default' */
  libraryId: string
  type: EntryType
  title: string
  content: string
  status: EntryStatus
  /** 毫秒时间戳；重复事件为首个实例 */
  startAt: number | null
  endAt: number | null
  recurrence: RecurrenceRule | null
  recurrenceUntil: number | null
  /** 预留：例外实例，本期不使用 */
  exceptions: unknown | null
  sourceType: EntrySourceType
  /** 会话 id 或文档 id */
  sourceRef: string | null
  confidence: number
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface CreateEntryInput {
  type: EntryType
  title: string
  content?: string
  status?: EntryStatus
  startAt?: number | null
  endAt?: number | null
  recurrence?: RecurrenceRule | null
  recurrenceUntil?: number | null
  sourceType?: EntrySourceType
  sourceRef?: string | null
  confidence?: number
  userId?: string
  libraryId?: string
}

export type UpdateEntryInput = Partial<Omit<CreateEntryInput, 'userId' | 'sourceType'>>
