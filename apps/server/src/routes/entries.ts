/**
 * 个人条目（记忆）管理 API — v5 核心
 *
 * GET    /api/entries        — 列表（?type=&status=&libraryId=&from=&to=&limit=）
 * POST   /api/entries        — 新建（手动创建默认 active；抽取链路另行创建 draft）
 * GET    /api/entries/:id    — 单条详情
 * PATCH  /api/entries/:id    — 更新（含状态流转：确认/完成/归档）
 * DELETE /api/entries/:id    — 永久删除（级联删除向量）
 *
 * 约定：
 *   - API 出入参统一 camelCase；drizzle 行 → rowToEntry 做映射（Date → 毫秒时间戳）
 *   - recurrence 为 RRULE 子集 JSON：{ freq, interval?, byWeekday?, byMonthDay?, until? }
 */

import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { and, desc, eq, gte, lte } from 'drizzle-orm'

import { getDb, tables } from '../db/index.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'
import { logger } from '../services/logger.js'

const router = Router()

// ── Zod 校验 Schema ─────────────────────────────────

const entryTypeEnum = z.enum(['schedule', 'plan', 'fact', 'note'])
const entryStatusEnum = z.enum(['draft', 'active', 'done', 'archived'])
const entrySourceTypeEnum = z.enum(['conversation', 'document', 'manual'])

const recurrenceSchema = z.object({
  freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  interval: z.number().int().min(1).max(365).optional(),
  byWeekday: z
    .array(z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']))
    .max(7)
    .optional(),
  byMonthDay: z.number().int().min(1).max(31).optional(),
  until: z.number().int().optional(),
})

/** schedule（含重复事件）必须有开始时间；endAt 不得早于 startAt */
const timeRule = (
  data: { type?: string; startAt?: number | null; endAt?: number | null },
  ctx: z.RefinementCtx,
) => {
  if (data.type === 'schedule' && (data.startAt === undefined || data.startAt === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startAt'],
      message: '日程（schedule）必须提供开始时间 startAt',
    })
  }
  if (
    data.startAt !== undefined &&
    data.startAt !== null &&
    data.endAt !== undefined &&
    data.endAt !== null &&
    data.endAt < data.startAt
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endAt'],
      message: 'endAt 不能早于 startAt',
    })
  }
}

const createEntrySchema = z
  .object({
    type: entryTypeEnum,
    title: z.string().min(1, '标题不能为空').max(100),
    content: z.string().max(10000).default(''),
    // 手动新建默认直接生效；对话抽取走 draft 由确认接口流转
    status: entryStatusEnum.default('active'),
    startAt: z.number().int().nullable().optional(),
    endAt: z.number().int().nullable().optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    recurrenceUntil: z.number().int().nullable().optional(),
    sourceType: entrySourceTypeEnum.default('manual'),
    sourceRef: z.string().max(128).nullable().optional(),
    confidence: z.number().min(0).max(1).default(1),
    userId: z.string().max(64).default('local'),
    libraryId: z.string().max(64).default('default'),
  })
  .superRefine(timeRule)

const updateEntrySchema = z
  .object({
    type: entryTypeEnum.optional(),
    title: z.string().min(1).max(100).optional(),
    content: z.string().max(10000).optional(),
    status: entryStatusEnum.optional(),
    startAt: z.number().int().nullable().optional(),
    endAt: z.number().int().nullable().optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    recurrenceUntil: z.number().int().nullable().optional(),
    sourceRef: z.string().max(128).nullable().optional(),
    confidence: z.number().min(0).max(1).optional(),
    libraryId: z.string().max(64).optional(),
  })
  .superRefine(timeRule)

const listEntriesQuerySchema = z.object({
  type: entryTypeEnum.optional(),
  status: entryStatusEnum.optional(),
  libraryId: z.string().max(64).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

const entryIdParam = z.object({ id: z.string().min(1) })

// ── 行 → API 对象映射 ────────────────────────────────

type EntryRow = typeof tables.entries.$inferSelect

const toMs = (d: Date | null): number | null => (d ? d.getTime() : null)
const toDate = (ms: number | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(ms)

const rowToEntry = (row: EntryRow) => ({
  id: row.id,
  userId: row.userId,
  libraryId: row.libraryId,
  type: row.type,
  title: row.title,
  content: row.content,
  status: row.status,
  startAt: toMs(row.startAt),
  endAt: toMs(row.endAt),
  recurrence: row.recurrence ?? null,
  recurrenceUntil: toMs(row.recurrenceUntil),
  exceptions: row.exceptions ?? null,
  sourceType: row.sourceType,
  sourceRef: row.sourceRef,
  confidence: row.confidence,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
  archivedAt: toMs(row.archivedAt),
})

const findEntry = async (id: string): Promise<EntryRow | undefined> => {
  const db = getDb()
  const rows = await db.select().from(tables.entries).where(eq(tables.entries.id, id)).limit(1)
  return rows[0]
}

// ── 路由 ─────────────────────────────────────────────

/** GET /api/entries — 列表查询 */
router.get(
  '/',
  validate({ query: listEntriesQuerySchema }),
  asyncHandler(async (req, res) => {
    // 再 parse 一次以应用 coerce/default（中间件只校验不回写）
    const { type, status, libraryId, from, to, limit } = listEntriesQuerySchema.parse(req.query)

    const conds = [
      type ? eq(tables.entries.type, type) : undefined,
      status ? eq(tables.entries.status, status) : undefined,
      libraryId ? eq(tables.entries.libraryId, libraryId) : undefined,
      from !== undefined ? gte(tables.entries.startAt, new Date(from)) : undefined,
      to !== undefined ? lte(tables.entries.startAt, new Date(to)) : undefined,
    ]

    const db = getDb()
    const rows = await db
      .select()
      .from(tables.entries)
      .where(and(...conds))
      .orderBy(desc(tables.entries.updatedAt))
      .limit(limit)

    res.json(rows.map(rowToEntry))
  }),
)

/** POST /api/entries — 新建条目 */
router.post(
  '/',
  validate({ body: createEntrySchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const id = randomUUID()
    const now = new Date()
    // 再 parse 一次以应用 Zod default（中间件只校验不回写）
    const body = createEntrySchema.parse(req.body)

    await db.insert(tables.entries).values({
      id,
      userId: body.userId,
      libraryId: body.libraryId,
      type: body.type,
      title: body.title,
      content: body.content,
      status: body.status,
      startAt: toDate(body.startAt),
      endAt: toDate(body.endAt),
      recurrence: body.recurrence ?? null,
      recurrenceUntil: toDate(body.recurrenceUntil),
      sourceType: body.sourceType,
      sourceRef: body.sourceRef ?? null,
      confidence: body.confidence,
      createdAt: now,
      updatedAt: now,
      archivedAt: body.status === 'archived' ? now : null,
    })

    const row = await findEntry(id)
    logger.info('entries.route', 'POST / 完成', {
      entryId: id,
      type: body.type,
      status: body.status,
    })
    res.status(201).json(rowToEntry(row!))
  }),
)

/** GET /api/entries/:id — 单条详情 */
router.get(
  '/:id',
  validate({ params: entryIdParam }),
  asyncHandler(async (req, res) => {
    const row = await findEntry(req.params.id)
    if (!row) throw createError('条目不存在', 404, 'ENTRY_NOT_FOUND')
    res.json(rowToEntry(row))
  }),
)

/** PATCH /api/entries/:id — 更新（含状态流转） */
router.patch(
  '/:id',
  validate({ params: entryIdParam, body: updateEntrySchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const id = req.params.id
    const existing = await findEntry(id)
    if (!existing) throw createError('条目不存在', 404, 'ENTRY_NOT_FOUND')

    // 再 parse 一次以应用 Zod default（中间件只校验不回写）
    const body = updateEntrySchema.parse(req.body)

    // 合并后校验：改为 schedule 或已是 schedule 时必须有 startAt
    const mergedType = body.type ?? existing.type
    const mergedStartAt = body.startAt !== undefined ? body.startAt : toMs(existing.startAt)
    if (mergedType === 'schedule' && mergedStartAt === null) {
      throw createError('日程（schedule）必须提供开始时间 startAt', 400, 'VALIDATION_ERROR')
    }

    const updates: Partial<typeof tables.entries.$inferInsert> = {}
    if (body.type !== undefined) updates.type = body.type
    if (body.title !== undefined) updates.title = body.title
    if (body.content !== undefined) updates.content = body.content
    if (body.startAt !== undefined) updates.startAt = toDate(body.startAt)
    if (body.endAt !== undefined) updates.endAt = toDate(body.endAt)
    if (body.recurrence !== undefined) updates.recurrence = body.recurrence
    if (body.recurrenceUntil !== undefined) updates.recurrenceUntil = toDate(body.recurrenceUntil)
    if (body.sourceRef !== undefined) updates.sourceRef = body.sourceRef
    if (body.confidence !== undefined) updates.confidence = body.confidence
    if (body.libraryId !== undefined) updates.libraryId = body.libraryId

    // 状态流转：归档时记录 archived_at，离开归档则清空
    if (body.status !== undefined) {
      updates.status = body.status
      updates.archivedAt = body.status === 'archived' ? new Date() : null
    }

    if (Object.keys(updates).length === 0) {
      res.json(rowToEntry(existing))
      return
    }

    updates.updatedAt = new Date()
    await db.update(tables.entries).set(updates).where(eq(tables.entries.id, id))

    const row = await findEntry(id)
    logger.info('entries.route', 'PATCH /:id 完成', {
      entryId: id,
      fields: Object.keys(updates).length - 1,
    })
    res.json(rowToEntry(row!))
  }),
)

/** DELETE /api/entries/:id — 永久删除（级联删除 entry_embeddings） */
router.delete(
  '/:id',
  validate({ params: entryIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const existing = await findEntry(req.params.id)
    if (!existing) throw createError('条目不存在', 404, 'ENTRY_NOT_FOUND')
    await db.delete(tables.entries).where(eq(tables.entries.id, req.params.id))
    logger.info('entries.route', 'DELETE /:id 完成', { entryId: req.params.id })
    res.status(204).end()
  }),
)

export default router
