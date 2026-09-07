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
 */

import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'

import { getDb } from '../db/index.js'
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

/** GET /api/sessions */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const db = getDb()
    const sessions = await db
      .prepare(
        `SELECT s.*, COUNT(m.id) as message_count
         FROM sessions s
         LEFT JOIN messages m ON m.session_id = s.id
         GROUP BY s.id
         ORDER BY s.updated_at DESC`
      )
      .all()
    res.json(sessions)
  })
)

/** POST /api/sessions */
router.post(
  '/',
  validate({ body: createSessionSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const now = Date.now()
    const id = randomUUID()
    const { title = '新对话', model = 'glm-4-flash', systemPrompt = null } = req.body

    await db.prepare(
      `INSERT INTO sessions (id, title, model, system_prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, title, model, systemPrompt, now, now)

    const session = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
    logger.info('sessions.route', 'POST / 完成', { sessionId: id, title })
    res.status(201).json(session)
  })
)

/** GET /api/sessions/:id */
router.get(
  '/:id',
  validate({ params: sessionIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const session = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id)
    if (!session) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')

    const messages = await db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(req.params.id)

    res.json({ ...(session as object), messages })
  })
)

/** PATCH /api/sessions/:id */
router.patch(
  '/:id',
  validate({ params: sessionIdParam, body: updateSessionSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const session = await db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id)
    if (!session) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')

    const now = Date.now()
    const updates: string[] = []
    const values: unknown[] = []

    if (req.body.title !== undefined) {
      updates.push('title = ?')
      values.push(req.body.title)
    }
    if (req.body.model !== undefined) {
      updates.push('model = ?')
      values.push(req.body.model)
    }
    if (req.body.systemPrompt !== undefined) {
      updates.push('system_prompt = ?')
      values.push(req.body.systemPrompt)
    }

    if (updates.length === 0) {
      res.json(session)
      return
    }

    updates.push('updated_at = ?')
    values.push(now, req.params.id)

    await db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    const updated = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id)
    res.json(updated)
  })
)

/** DELETE /api/sessions/:id */
router.delete(
  '/:id',
  validate({ params: sessionIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const result = await db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id)
    if (result.changes === 0) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')
    logger.info('sessions.route', 'DELETE /:id 完成', { sessionId: req.params.id })
    res.status(204).end()
  })
)

/** POST /api/sessions/:id/messages */
router.post(
  '/:id/messages',
  validate({ params: sessionIdParam, body: addMessageSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const session = await db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id)
    if (!session) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')

    const now = Date.now()
    const msgId = randomUUID()
    const { role, content, metadata } = req.body

    const insert = db.prepare(
      `INSERT INTO messages (id, session_id, role, content, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )

    await insert.run(
      msgId,
      req.params.id,
      role,
      content,
      metadata ? JSON.stringify(metadata) : null,
      now
    )

    await db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, req.params.id)

    const message = await db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId)
    logger.info('sessions.route', 'POST /:id/messages 完成', { sessionId: req.params.id, role })
    res.status(201).json(message)
  })
)

/** DELETE /api/sessions/:id/messages — 清空会话消息 */
router.delete(
  '/:id/messages',
  validate({ params: sessionIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const result = await db.prepare('DELETE FROM messages WHERE session_id = ?').run(req.params.id)
    const now = Date.now()
    await db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, req.params.id)
    logger.info('sessions.route', 'DELETE /:id/messages 完成', { sessionId: req.params.id, deleted: result.changes })
    res.status(204).end()
  })
)

export default router
