/**
 * Agent API 路由
 * POST   /api/agent/run       — 启动 Agent 执行（流式 streamEvents v2）
 * POST   /api/agent/pause    — 暂停 Agent（Human-in-the-loop）
 * POST   /api/agent/resume   — 恢复 Agent
 * POST   /api/agent/rollback — 回滚到指定步骤
 * GET    /api/agent/status/:threadId — 查询 Agent 状态
 */

import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'

import { createAgentExecutor, getState, agentInputSchema } from '../services/agent/agent.js'
import { logger } from '../services/logger.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'

const router = Router()

const pauseSchema = z.object({ threadId: z.string().min(1) })
const resumeSchema = z.object({ threadId: z.string().min(1), input: z.string().min(1) })
const rollbackSchema = z.object({ threadId: z.string().min(1), step: z.coerce.number().int().min(0) })

/** POST /api/agent/run — 启动 Agent 流式执行 */
router.post(
  '/run',
  validate({ body: agentInputSchema }),
  asyncHandler(async (req, res) => {
    const { threadId, input, allowedToolIds, maxIterations, systemPrompt } = req.body
    const tid = threadId || randomUUID()
    logger.info('agent.route', 'POST /run — 入口 (SSE)', { threadId: tid })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const executor = createAgentExecutor({
      enabledToolIds: allowedToolIds,
      maxIterations,
      systemPrompt,
    })

    res.write(`data: ${JSON.stringify({ type: 'thread_id', threadId: tid })}\n\n`)

    try {
      for await (const event of executor.streamEvents(tid, input)) {
        res.write(`data: ${JSON.stringify({ type: 'event', ...event })}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ type: 'done', threadId: tid })}\n\n`)
      logger.info('agent.route', 'POST /run — 完成', { threadId: tid })
    } catch (err) {
      if (!res.headersSent) throw err
      logger.error('agent.route', 'POST /run — 错误', { threadId: tid, error: (err as Error).message })
      res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`)
    }
    res.end()
  })
)

/** POST /api/agent/pause */
router.post(
  '/pause',
  validate({ body: pauseSchema }),
  asyncHandler(async (req, res) => {
    logger.info('agent.route', 'POST /pause — 入口', { threadId: req.body.threadId })
    const executor = createAgentExecutor()
    const state = executor.pause(req.body.threadId)
    logger.info('agent.route', 'POST /pause — 出口', { threadId: req.body.threadId })
    res.json({ success: true, state })
  })
)

/** POST /api/agent/resume */
router.post(
  '/resume',
  validate({ body: resumeSchema }),
  asyncHandler(async (req, res) => {
    logger.info('agent.route', 'POST /resume — 入口 (SSE)', { threadId: req.body.threadId })
    const executor = createAgentExecutor()
    const stream = await executor.resume(req.body.threadId, req.body.input)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    for await (const event of stream) {
      res.write(`data: ${JSON.stringify({ type: 'event', ...event })}\n\n`)
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    logger.info('agent.route', 'POST /resume — 完成', { threadId: req.body.threadId })
    res.end()
  })
)

/** POST /api/agent/rollback */
router.post(
  '/rollback',
  validate({ body: rollbackSchema }),
  asyncHandler(async (req, res) => {
    logger.info('agent.route', 'POST /rollback — 入口', { threadId: req.body.threadId, step: req.body.step })
    const executor = createAgentExecutor()
    const state = executor.rollback(req.body.threadId, req.body.step)
    logger.info('agent.route', 'POST /rollback — 出口', { threadId: req.body.threadId })
    res.json({ success: true, state })
  })
)

/** GET /api/agent/status/:threadId */
router.get<{ threadId: string }>(
  '/status/:threadId',
  asyncHandler(async (req, res) => {
    logger.info('agent.route', 'GET /status/:threadId — 入口', { threadId: req.params.threadId })
    const state = getState(req.params.threadId)
    logger.info('agent.route', 'GET /status/:threadId — 出口', { threadId: req.params.threadId })
    res.json(state)
  })
)

export default router
