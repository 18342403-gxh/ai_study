/**
 * Function Calling API 路由
 * GET    /api/tools/list        — 获取可用工具列表（支持前端白名单过滤）
 * POST   /api/tools/execute    — 直接执行指定工具
 * POST   /api/tools/run        — 启动 Function Calling 循环（流式）
 */

import { Router } from 'express'
import { z } from 'zod'

import {
  getAllTools,
  getToolsByWhitelist,
  executeTool,
  initDefaultTools,
} from '../services/tools/registerTools.js'
import { createFunctionCallingEngine } from '../services/tools/engine.js'
import { logger } from '../services/logger.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'

initDefaultTools()

const router = Router()

const executeSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  sessionId: z.string().optional(),
})

const runSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string(),
  })),
  userInput: z.string().optional(),
  allowedToolIds: z.array(z.string()).optional(),
  maxIterations: z.coerce.number().int().min(1).max(20).default(5),
  systemPrompt: z.string().optional(),
  sessionId: z.string().optional(),
})

/** GET /api/tools/list */
router.get(
  '/list',
  asyncHandler(async (req, res) => {
    logger.info('tools.route', 'GET /list — 入口')
    const allowedIds = req.query.allowedToolIds as string[] | undefined
    const tools = allowedIds && allowedIds.length > 0
      ? getToolsByWhitelist(allowedIds)
      : getAllTools()

    logger.info('tools.route', 'GET /list — 出口', { count: tools.length })
    res.json({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        schema: t.schema._def,
      })),
      count: tools.length,
    })
  })
)

/** POST /api/tools/execute — 直接执行单个工具 */
router.post(
  '/execute',
  validate({ body: executeSchema }),
  asyncHandler(async (req, res) => {
    const { toolName, args, sessionId } = req.body
    logger.info('tools.route', 'POST /execute — 入口', { toolName })
    const result = await executeTool(toolName, args, { sessionId })
    logger.info('tools.route', 'POST /execute — 出口', { toolName })
    res.json({ toolName, result })
  })
)

/** POST /api/tools/run — 启动 Function Calling 循环（流式事件） */
router.post(
  '/run',
  validate({ body: runSchema }),
  asyncHandler(async (req, res) => {
    const { messages, userInput, allowedToolIds, maxIterations, systemPrompt, sessionId } = req.body
    logger.info('tools.route', 'POST /run — 入口 (SSE)', { maxIterations, sessionId })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const engine = createFunctionCallingEngine({
      allowedToolIds,
      maxIterations,
      systemPrompt,
      context: { sessionId },
    })

    try {
      for await (const event of engine.stream(messages as Array<{ role: string; content: string }>, userInput)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      logger.info('tools.route', 'POST /run — 完成', { sessionId })
    } catch (err) {
      if (!res.headersSent) throw err
      logger.error('tools.route', 'POST /run — 错误', { sessionId, error: (err as Error).message })
      res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`)
    }
    res.end()
  })
)

export default router
