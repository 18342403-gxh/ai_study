/**
 * Generator API 路由
 * POST /api/generator/run       — 启动生成（流式，5 节点编排，支持 component / skill 双模式）
 * POST /api/generator/iterate   — 根据反馈迭代
 * GET  /api/generator/state/:id — 查询生成状态
 */

import { Router } from 'express'

import { createGeneratorAgent, generatorInputSchema, generatorIterateSchema } from '../services/generator/agent.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'

const router = Router()
const generator = createGeneratorAgent({ enableRAG: true })

/** POST /api/generator/run */
router.post(
  '/run',
  validate({ body: generatorInputSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body
    const { requirement, artifactType, framework, skillName, scriptLang } = body

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
    } catch (err) {
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

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    for await (const event of generator.iterate(stateId, feedback)) {
      res.write(`data: ${JSON.stringify({ type: 'event', ...event })}\n\n`)
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  })
)

/** GET /api/generator/state/:id */
router.get<{ id: string }>(
  '/state/:id',
  asyncHandler(async (req, res) => {
    const state = generator.getState(req.params.id)
    if (!state) throw createError('状态不存在', 404, 'STATE_NOT_FOUND')
    res.json(state)
  })
)

export default router
