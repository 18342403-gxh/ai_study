/**
 * 日志查看 API
 *
 * GET /api/logs          — 历史日志（支持 ?level=&limit= 过滤）
 * GET /api/logs/stream   — SSE 实时推送新日志
 */

import { Router } from 'express'
import { getLogs, subscribeLogs, type LogLevel } from '../middleware/logger.js'

const router = Router()

/** GET /api/logs — 历史 */
router.get('/', (req, res) => {
  const level = (req.query.level as string | undefined)?.toUpperCase() as LogLevel | undefined
  const limit = Number(req.query.limit) || 200
  res.json(getLogs({ level, limit }))
})

/** GET /api/logs/stream — SSE */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // 心跳（防止代理/浏览器超时断连）
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n')
  }, 15000)

  const unsubscribe = subscribeLogs((entry) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`)
    }
  })

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

export default router
