/**
 * 会话管理 API
 * 会话历史的服务端持久化，替代纯前端 localStorage
 *
 * GET    /api/sessions          — 列出所有会话
 * POST   /api/sessions          — 创建新会话
 * GET    /api/sessions/:id      — 获取单个会话（含消息）
 * PATCH  /api/sessions/:id      — 更新会话标题/配置
 * DELETE /api/sessions/:id      — 删除会话（级联删除消息）
 * POST   /api/sessions/:id/messages      — 添加消息
 * DELETE /api/sessions/:id/messages     — 清空会话消息
 *
 * 约定：
 *   - API 出入参保持旧形状：snake_case 字段 + 毫秒时间戳
 *   - messages.metadata 是普通 text 列，业务层手动 JSON.stringify（透传 string）
 */

import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { asc, count, desc, eq, getTableColumns } from 'drizzle-orm'

import { getDb, tables } from '../db/index.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'
import { logger } from '../services/logger.js'

const router = Router()

const createSessionSchema = z.object({
  title: z.string().max(100).optional(),
  model: z.string().max(50).optional(),
  systemPrompt: z.string().optional(),
})

const updateSessionSchema = z.object({
  title: z.string().max(100).optional(),
  model: z.string().max(50).optional(),
  systemPrompt: z.string().nullable().optional(),
})

const addMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const sessionIdParam = z.object({ id: z.string().min(1) })

// ── 行 → API 对象映射（snake_case + 毫秒时间戳） ──────────

type SessionRow = typeof tables.sessions.$inferSelect
type MessageRow = typeof tables.messages.$inferSelect

const toMs = (d: Date | null): number | null => (d ? d.getTime() : null)

const rowToSession = (row: SessionRow) => ({
  id: row.id,
  title: row.title,
  model: row.model,
  system_prompt: row.systemPrompt,
  metadata: row.metadata ?? null,
  created_at: row.createdAt.getTime(),
  updated_at: row.updatedAt.getTime(),
  deleted_at: toMs(row.deletedAt),
})

const rowToMessage = (row: MessageRow) => ({
  id: row.id,
  session_id: row.sessionId,
  role: row.role,
  content: row.content,
  tool_call_id: row.toolCallId,
  citations: row.citations ?? null,
  metadata: row.metadata,
  created_at: row.createdAt.getTime(),
})

const findSession = async (id: string): Promise<SessionRow | undefined> => {
  const db = getDb()
  const rows = await db.select().from(tables.sessions).where(eq(tables.sessions.id, id)).limit(1)
  return rows[0]
}

/** GET /api/sessions */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const db = getDb()
    const rows = await db
      .select({
        ...getTableColumns(tables.sessions),
        messageCount: count(tables.messages.id),
      })
      .from(tables.sessions)
      .leftJoin(tables.messages, eq(tables.messages.sessionId, tables.sessions.id))
      .groupBy(tables.sessions.id)
      .orderBy(desc(tables.sessions.updatedAt))

    res.json(rows.map((row) => ({ ...rowToSession(row), message_count: Number(row.messageCount) })))
  }),
)

/** POST /api/sessions */
router.post(
  '/',
  validate({ body: createSessionSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const now = new Date()
    const id = randomUUID()
    const { title = '新对话', model = 'glm-4-flash', systemPrompt = null } = req.body

    await db.insert(tables.sessions).values({
      id,
      title,
      model,
      systemPrompt,
      createdAt: now,
      updatedAt: now,
    })

    const session = await findSession(id)
    logger.info('sessions.route', 'POST / 完成', { sessionId: id, title })
    res.status(201).json(rowToSession(session!))
  }),
)

/** GET /api/sessions/:id */
router.get(
  '/:id',
  validate({ params: sessionIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const session = await findSession(req.params.id)
    if (!session) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')

    const messages = await db
      .select()
      .from(tables.messages)
      .where(eq(tables.messages.sessionId, req.params.id))
      .orderBy(asc(tables.messages.createdAt))

    res.json({ ...rowToSession(session), messages: messages.map(rowToMessage) })
  }),
)

/** PATCH /api/sessions/:id */
router.patch(
  '/:id',
  validate({ params: sessionIdParam, body: updateSessionSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const session = await findSession(req.params.id)
    if (!session) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')

    const updates: Partial<typeof tables.sessions.$inferInsert> = {}
    if (req.body.title !== undefined) updates.title = req.body.title
    if (req.body.model !== undefined) updates.model = req.body.model
    if (req.body.systemPrompt !== undefined) updates.systemPrompt = req.body.systemPrompt

    if (Object.keys(updates).length === 0) {
      res.json(rowToSession(session))
      return
    }

    updates.updatedAt = new Date()
    await db.update(tables.sessions).set(updates).where(eq(tables.sessions.id, req.params.id))

    const updated = await findSession(req.params.id)
    res.json(rowToSession(updated!))
  }),
)

/** DELETE /api/sessions/:id */
router.delete(
  '/:id',
  validate({ params: sessionIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const session = await findSession(req.params.id)
    if (!session) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')
    await db.delete(tables.sessions).where(eq(tables.sessions.id, req.params.id))
    logger.info('sessions.route', 'DELETE /:id 完成', { sessionId: req.params.id })
    res.status(204).end()
  }),
)

/** POST /api/sessions/:id/messages */
router.post(
  '/:id/messages',
  validate({ params: sessionIdParam, body: addMessageSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const session = await findSession(req.params.id)
    if (!session) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')

    const now = new Date()
    const msgId = randomUUID()
    const { role, content, metadata } = req.body

    await db.insert(tables.messages).values({
      id: msgId,
      sessionId: req.params.id,
      role,
      content,
      metadata: metadata ? JSON.stringify(metadata) : null,
      createdAt: now,
    })

    await db
      .update(tables.sessions)
      .set({ updatedAt: now })
      .where(eq(tables.sessions.id, req.params.id))

    const rows = await db
      .select()
      .from(tables.messages)
      .where(eq(tables.messages.id, msgId))
      .limit(1)
    logger.info('sessions.route', 'POST /:id/messages 完成', { sessionId: req.params.id, role })
    res.status(201).json(rowToMessage(rows[0]!))
  }),
)

/** DELETE /api/sessions/:id/messages — 清空会话消息 */
router.delete(
  '/:id/messages',
  validate({ params: sessionIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    await db.delete(tables.messages).where(eq(tables.messages.sessionId, req.params.id))
    await db
      .update(tables.sessions)
      .set({ updatedAt: new Date() })
      .where(eq(tables.sessions.id, req.params.id))
    logger.info('sessions.route', 'DELETE /:id/messages 完成', {
      sessionId: req.params.id,
    })
    res.status(204).end()
  }),
)

export default router
