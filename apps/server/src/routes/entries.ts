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
 *   - API 出入参统一 camelCase；DB 存 snake_case，rowToEntry 做映射
 *   - 时间字段为毫秒时间戳（PG 驱动层自动转 TIMESTAMPTZ）
 *   - recurrence 为 RRULE 子集 JSON：{ freq, interval?, byWeekday?, byMonthDay?, until? }
 */

import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'

import { getDb } from '../db/index.js'
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

interface EntryRow {
  id: string
  user_id: string
  library_id: string
  type: string
  title: string
  content: string
  status: string
  start_at: number | null
  end_at: number | null
  recurrence: string | null
  recurrence_until: number | null
  exceptions: string | null
  source_type: string
  source_ref: string | null
  confidence: number
  created_at: number
  updated_at: number
  archived_at: number | null
}

/** JSON 字段解析：SQLite 存 TEXT，PG jsonb 直接是对象 */
const parseJsonColumn = (v: unknown): unknown => {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  }
  return v
}

const rowToEntry = (row: EntryRow) => ({
  id: row.id,
  userId: row.user_id,
  libraryId: row.library_id,
  type: row.type,
  title: row.title,
  content: row.content,
  status: row.status,
  startAt: row.start_at,
  endAt: row.end_at,
  recurrence: parseJsonColumn(row.recurrence),
  recurrenceUntil: row.recurrence_until,
  exceptions: parseJsonColumn(row.exceptions),
  sourceType: row.source_type,
  sourceRef: row.source_ref,
  confidence: row.confidence,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
})

// ── 路由 ─────────────────────────────────────────────

/** GET /api/entries — 列表查询 */
router.get(
  '/',
  validate({ query: listEntriesQuerySchema }),
  asyncHandler(async (req, res) => {
    // 再 parse 一次以应用 coerce/default（中间件只校验不回写）
    const { type, status, libraryId, from, to, limit } = listEntriesQuerySchema.parse(req.query)

    const conds: string[] = []
    const params: unknown[] = []
    if (type) {
      conds.push('type = ?')
      params.push(type)
    }
    if (status) {
      conds.push('status = ?')
      params.push(status)
    }
    if (libraryId) {
      conds.push('library_id = ?')
      params.push(libraryId)
    }
    if (from !== undefined) {
      conds.push('start_at >= ?')
      params.push(from)
    }
    if (to !== undefined) {
      conds.push('start_at <= ?')
      params.push(to)
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''

    const db = getDb()
    const rows = await db
      .prepare(`SELECT * FROM entries ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all<EntryRow>(...params, limit)

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
    const now = Date.now()
    // 再 parse 一次以应用 Zod default（中间件只校验不回写）
    const body = createEntrySchema.parse(req.body)

    const archivedAt = body.status === 'archived' ? now : null

    await db
      .prepare(
        `INSERT INTO entries
           (id, user_id, library_id, type, title, content, status,
            start_at, end_at, recurrence, recurrence_until, exceptions,
            source_type, source_ref, confidence, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        body.userId,
        body.libraryId,
        body.type,
        body.title,
        body.content,
        body.status,
        body.startAt ?? null,
        body.endAt ?? null,
        body.recurrence ? JSON.stringify(body.recurrence) : null,
        body.recurrenceUntil ?? null,
        body.sourceType,
        body.sourceRef ?? null,
        body.confidence,
        now,
        now,
        archivedAt,
      )

    const row = await db.prepare('SELECT * FROM entries WHERE id = ?').get<EntryRow>(id)
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
    const db = getDb()
    const row = await db.prepare('SELECT * FROM entries WHERE id = ?').get<EntryRow>(req.params.id)
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
    const existing = await db.prepare('SELECT * FROM entries WHERE id = ?').get<EntryRow>(id)
    if (!existing) throw createError('条目不存在', 404, 'ENTRY_NOT_FOUND')

    // 再 parse 一次以应用 Zod default（中间件只校验不回写）
    const body = updateEntrySchema.parse(req.body)

    // 合并后校验：改为 schedule 或已是 schedule 时必须有 startAt
    const mergedType = body.type ?? existing.type
    const mergedStartAt = body.startAt !== undefined ? body.startAt : existing.start_at
    if (mergedType === 'schedule' && mergedStartAt === null) {
      throw createError('日程（schedule）必须提供开始时间 startAt', 400, 'VALIDATION_ERROR')
    }

    const updates: string[] = []
    const values: unknown[] = []
    const setField = (col: string, val: unknown) => {
      updates.push(`${col} = ?`)
      values.push(val)
    }

    if (body.type !== undefined) setField('type', body.type)
    if (body.title !== undefined) setField('title', body.title)
    if (body.content !== undefined) setField('content', body.content)
    if (body.startAt !== undefined) setField('start_at', body.startAt)
    if (body.endAt !== undefined) setField('end_at', body.endAt)
    if (body.recurrence !== undefined)
      setField('recurrence', body.recurrence ? JSON.stringify(body.recurrence) : null)
    if (body.recurrenceUntil !== undefined) setField('recurrence_until', body.recurrenceUntil)
    if (body.sourceRef !== undefined) setField('source_ref', body.sourceRef)
    if (body.confidence !== undefined) setField('confidence', body.confidence)
    if (body.libraryId !== undefined) setField('library_id', body.libraryId)

    // 状态流转：归档时记录 archived_at，离开归档则清空
    if (body.status !== undefined) {
      setField('status', body.status)
      setField('archived_at', body.status === 'archived' ? Date.now() : null)
    }

    if (updates.length === 0) {
      res.json(rowToEntry(existing))
      return
    }

    setField('updated_at', Date.now())
    values.push(id)

    await db.prepare(`UPDATE entries SET ${updates.join(', ')} WHERE id = ?`).run(...values)

    const row = await db.prepare('SELECT * FROM entries WHERE id = ?').get<EntryRow>(id)
    logger.info('entries.route', 'PATCH /:id 完成', {
      entryId: id,
      fields: updates.length - 1,
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
    const result = await db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id)
    if (result.changes === 0) throw createError('条目不存在', 404, 'ENTRY_NOT_FOUND')
    logger.info('entries.route', 'DELETE /:id 完成', { entryId: req.params.id })
    res.status(204).end()
  }),
)

export default router
