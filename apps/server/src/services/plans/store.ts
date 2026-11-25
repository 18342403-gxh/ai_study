/**
 * 长期规划存储层
 *
 * 约定：
 *   - API 出入参 camelCase，时间为毫秒时间戳
 *   - stages 以 JSONB 存储，读出时归一化
 */

import { randomUUID } from 'crypto'
import { and, desc, eq } from 'drizzle-orm'

import { getDb, tables } from '../../db/index.js'

export type PlanStatus = 'draft' | 'active' | 'done' | 'archived'
export type PlanSourceType = 'conversation' | 'document' | 'manual'

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

export interface Plan {
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
  sourceType: PlanSourceType
  sourceRef: string | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface CreatePlanPayload {
  title: string
  goal?: string
  status?: PlanStatus
  startAt?: number | null
  endAt?: number | null
  progress?: number
  stages?: PlanStage[]
  sourceType?: PlanSourceType
  sourceRef?: string | null
  userId?: string
  libraryId?: string
}

export interface UpdatePlanPayload {
  title?: string
  goal?: string
  status?: PlanStatus
  startAt?: number | null
  endAt?: number | null
  progress?: number
  stages?: PlanStage[]
  libraryId?: string
}

export interface PlanDraft {
  title: string
  goal: string
  startAt: number | null
  endAt: number | null
  stages: PlanStage[]
  sources: PlanSource[]
  grounded: boolean
}

type PlanRow = typeof tables.plans.$inferSelect

const toMs = (d: Date | null): number | null => (d ? d.getTime() : null)
const toDate = (ms: number | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(ms)

/** stages 归一化：丢弃空标题、补齐类型、生成稳定 id */
export const normalizeStages = (stages: PlanStage[] | null | undefined): PlanStage[] =>
  (stages ?? [])
    .filter((stage) => typeof stage?.title === 'string' && stage.title.trim().length > 0)
    .slice(0, 20)
    .map((stage) => ({
      id: stage.id ?? randomUUID(),
      title: stage.title.trim().slice(0, 200),
      description: stage.description?.trim().slice(0, 2000) || undefined,
      targetAt: typeof stage.targetAt === 'number' ? stage.targetAt : null,
      done: Boolean(stage.done),
    }))

const clampProgress = (value: number | undefined): number =>
  Math.max(0, Math.min(100, Math.round(value ?? 0)))

export const rowToPlan = (row: PlanRow): Plan => ({
  id: row.id,
  userId: row.userId,
  libraryId: row.libraryId,
  title: row.title,
  goal: row.goal,
  status: row.status as PlanStatus,
  startAt: toMs(row.startAt),
  endAt: toMs(row.endAt),
  progress: row.progress,
  stages: normalizeStages(row.stages as PlanStage[] | null),
  sourceType: row.sourceType as PlanSourceType,
  sourceRef: row.sourceRef,
  createdAt: toMs(row.createdAt) ?? 0,
  updatedAt: toMs(row.updatedAt) ?? 0,
  archivedAt: toMs(row.archivedAt),
})

export const listPlans = async (options: {
  status?: PlanStatus
  libraryId?: string
  limit?: number
}): Promise<Plan[]> => {
  const db = getDb()
  const conditions = []
  if (options.status) conditions.push(eq(tables.plans.status, options.status))
  if (options.libraryId) conditions.push(eq(tables.plans.libraryId, options.libraryId))

  const rows = await db
    .select()
    .from(tables.plans)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tables.plans.createdAt))
    .limit(options.limit ?? 100)

  return rows.map(rowToPlan)
}

export const getPlan = async (id: string, libraryId?: string): Promise<Plan | null> => {
  const db = getDb()
  const rows = await db
    .select()
    .from(tables.plans)
    .where(
      libraryId
        ? and(eq(tables.plans.id, id), eq(tables.plans.libraryId, libraryId))
        : eq(tables.plans.id, id),
    )
    .limit(1)
  return rows[0] ? rowToPlan(rows[0]) : null
}

export const createPlan = async (payload: CreatePlanPayload): Promise<Plan> => {
  const db = getDb()
  const now = new Date()
  const id = randomUUID()
  await db.insert(tables.plans).values({
    id,
    userId: payload.userId ?? 'local',
    libraryId: payload.libraryId ?? 'default',
    title: payload.title.trim(),
    goal: payload.goal ?? '',
    status: payload.status ?? 'active',
    startAt: toDate(payload.startAt),
    endAt: toDate(payload.endAt),
    progress: clampProgress(payload.progress),
    stages: normalizeStages(payload.stages),
    sourceType: payload.sourceType ?? 'manual',
    sourceRef: payload.sourceRef ?? null,
    createdAt: now,
    updatedAt: now,
    archivedAt: payload.status === 'archived' ? now : null,
  })
  const created = await getPlan(id)
  return created as Plan
}

export const updatePlan = async (
  id: string,
  patch: UpdatePlanPayload,
  libraryId?: string,
): Promise<Plan | null> => {
  const db = getDb()
  const existing = await getPlan(id, libraryId)
  if (!existing) return null

  const now = new Date()
  const values: Partial<typeof tables.plans.$inferInsert> = { updatedAt: now }
  if (patch.title !== undefined) values.title = patch.title.trim()
  if (patch.goal !== undefined) values.goal = patch.goal
  if (patch.startAt !== undefined) values.startAt = toDate(patch.startAt)
  if (patch.endAt !== undefined) values.endAt = toDate(patch.endAt)
  if (patch.progress !== undefined) values.progress = clampProgress(patch.progress)
  if (patch.stages !== undefined) values.stages = normalizeStages(patch.stages)
  if (patch.status !== undefined) {
    values.status = patch.status
    values.archivedAt =
      patch.status === 'archived'
        ? existing.archivedAt
          ? new Date(existing.archivedAt)
          : now
        : null
  }

  await db.update(tables.plans).set(values).where(eq(tables.plans.id, id))
  return getPlan(id, libraryId)
}

export const deletePlan = async (id: string, libraryId?: string): Promise<boolean> => {
  const db = getDb()
  const existing = await getPlan(id, libraryId)
  if (!existing) return false
  await db.delete(tables.plans).where(eq(tables.plans.id, id))
  return true
}

/** AI 草稿确认入库 */
export const insertDraftPlan = async (options: {
  draft: PlanDraft
  sessionId?: string | null
  userId?: string
  libraryId?: string
  sourceType?: PlanSourceType
}): Promise<Plan> =>
  createPlan({
    title: options.draft.title,
    goal: options.draft.goal,
    status: 'active',
    startAt: options.draft.startAt,
    endAt: options.draft.endAt,
    progress: 0,
    stages: options.draft.stages,
    sourceType: options.sourceType ?? 'conversation',
    sourceRef: options.sessionId ?? null,
    userId: options.userId,
    libraryId: options.libraryId,
  })

/** 规划上下文：进行中的规划摘要（供生成时参考） */
export const listActivePlanBriefs = async (
  libraryId: string,
  limit = 8,
): Promise<Array<{ id: string; title: string; goal: string; endAt: number | null }>> => {
  const plans = await listPlans({ status: 'active', libraryId, limit })
  return plans.map((plan) => ({
    id: plan.id,
    title: plan.title,
    goal: plan.goal,
    endAt: plan.endAt,
  }))
}

export type ConvertEntryResult =
  | { ok: true; plan: Plan; alreadyConverted: boolean }
  | { ok: false; reason: 'ENTRY_NOT_FOUND' | 'ENTRY_NOT_PLAN' }

/** 把旧的 type=plan 条目转为长期规划，并把原条目归档（幂等） */
export const convertEntryToPlan = async (
  entryId: string,
  options: { userId: string; libraryId: string },
): Promise<ConvertEntryResult> => {
  const db = getDb()
  const entryRows = await db
    .select()
    .from(tables.entries)
    .where(and(eq(tables.entries.id, entryId), eq(tables.entries.libraryId, options.libraryId)))
    .limit(1)
  const entry = entryRows[0]
  if (!entry) return { ok: false, reason: 'ENTRY_NOT_FOUND' }
  if (entry.type !== 'plan') return { ok: false, reason: 'ENTRY_NOT_PLAN' }

  const convertedRows = await db
    .select()
    .from(tables.plans)
    .where(
      and(
        eq(tables.plans.sourceType, 'manual'),
        eq(tables.plans.sourceRef, entry.id),
        eq(tables.plans.libraryId, options.libraryId),
      ),
    )
    .limit(1)
  if (convertedRows[0]) {
    return { ok: true, plan: rowToPlan(convertedRows[0]), alreadyConverted: true }
  }

  const plan = await createPlan({
    title: entry.title,
    goal: entry.content,
    status: entry.status === 'done' ? 'done' : 'active',
    startAt: entry.startAt ? entry.startAt.getTime() : null,
    endAt: entry.endAt ? entry.endAt.getTime() : null,
    sourceType: 'manual',
    sourceRef: entry.id,
    userId: options.userId,
    libraryId: options.libraryId,
  })

  await db
    .update(tables.entries)
    .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(tables.entries.id, entry.id))

  return { ok: true, plan, alreadyConverted: false }
}
