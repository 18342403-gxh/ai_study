/**
 * Generator API 路由
 * POST   /api/generator/run           — 启动生成（流式，5 节点编排，支持 component / skill 双模式）
 * POST   /api/generator/iterate       — 根据反馈迭代
 * GET    /api/generator/state/:id      — 查询生成状态
 * GET    /api/generator/sessions       — 历史列表（支持分页 + type 过滤）
 * GET    /api/generator/sessions/:id   — 历史详情（含所有迭代 + 文件版本）
 * DELETE /api/generator/sessions/:id   — 软删除
 */

import { Router } from 'express'
import { z } from 'zod'

import { createGeneratorAgent, generatorInputSchema, generatorIterateSchema } from '../services/generator/agent.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import { logger } from '../services/logger.js'

const router = Router()
const generator = createGeneratorAgent({ enableRAG: true })

const stateIdParam = z.object({ id: z.string().min(1) })
const listQuerySchema = z.object({
  type: z.enum(['component', 'skill']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

/** POST /api/generator/run */
router.post(
  '/run',
  validate({ body: generatorInputSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body
    const { requirement, artifactType, framework, skillName, scriptLang } = body

    logger.info('generator.route', 'POST /run 开始', { artifactType, framework })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
      for await (const event of generator.stream({
        requirement,
        artifactType,
        framework,
        skillName,
        scriptLang,
      })) {
        res.write(`data: ${JSON.stringify({ type: 'event', ...event })}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      logger.info('generator.route', 'POST /run 完成')
    } catch (err) {
      logger.error('generator.route', 'POST /run 失败', { error: (err as Error).message })
      if (!res.headersSent) throw err
      res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`)
    }
    res.end()
  })
)

/** POST /api/generator/iterate */
router.post(
  '/iterate',
  validate({ body: generatorIterateSchema }),
  asyncHandler(async (req, res) => {
    const { stateId, feedback } = req.body

    logger.info('generator.route', 'POST /iterate 开始', { stateId })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
      for await (const event of generator.iterate(stateId, feedback)) {
        res.write(`data: ${JSON.stringify({ type: 'event', ...event })}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      logger.info('generator.route', 'POST /iterate 完成', { stateId })
    } catch (err) {
      logger.error('generator.route', 'POST /iterate 失败', { stateId, error: (err as Error).message })
      if (!res.headersSent) throw err
      res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`)
    }
    res.end()
  })
)

/** GET /api/generator/state/:id */
router.get(
  '/state/:id',
  validate({ params: stateIdParam }),
  asyncHandler(async (req, res) => {
    const state = generator.getState(req.params.id)
    if (!state) throw createError('状态不存在', 404, 'STATE_NOT_FOUND')
    res.json(state)
  })
)

// ── History 列表 ──────────────────────────────────────────────

/** GET /api/generator/sessions */
router.get(
  '/sessions',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const { type, limit, offset } = req.query as unknown as { type?: string; limit: number; offset: number }

    const realLimit = Number(limit) || 20
    const realOffset = Number(offset) || 0

    const sessions = await db
      .prepare(
        `SELECT s.id, s.requirement, s.artifact_type, s.framework, s.skill_name,
                s.status, s.iteration, s.created_at, s.updated_at,
                (SELECT COUNT(*) FROM generator_files f WHERE f.session_id = s.id AND f.is_current = true) as file_count
         FROM generator_sessions s
         WHERE s.deleted_at IS NULL${type ? ' AND s.artifact_type = ?' : ''}
         ORDER BY s.updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...(type ? [type, realLimit, realOffset] : [realLimit, realOffset]))

    res.json(sessions)
  })
)

/** GET /api/generator/sessions/:id — 详情（含文件版本） */
router.get(
  '/sessions/:id',
  validate({ params: stateIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const id = req.params.id

    logger.info('generator.route', 'GET /sessions/:id', { sessionId: id })

    const session = await db
      .prepare('SELECT * FROM generator_sessions WHERE id = ? AND deleted_at IS NULL')
      .get(id)
    if (!session) throw createError('生成记录不存在', 404, 'SESSION_NOT_FOUND')

    // 所有文件版本（按 iteration + file_path 排序）
    const files = await db
      .prepare(
        `SELECT id, iteration, file_path, content, language, is_current, created_at
         FROM generator_files
         WHERE session_id = ?
         ORDER BY iteration ASC, file_path ASC`
      )
      .all(id)

    res.json({ ...(session as object), files })
  })
)

/** DELETE /api/generator/sessions/:id — 软删除 */
router.delete(
  '/sessions/:id',
  validate({ params: stateIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const now = Date.now()
    const id = req.params.id

    logger.info('generator.route', 'DELETE /sessions/:id', { sessionId: id })

    const result = await db
      .prepare('UPDATE generator_sessions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(now, id)
    if (result.changes === 0) throw createError('生成记录不存在', 404, 'SESSION_NOT_FOUND')

    res.status(204).end()
  })
)

export default router
