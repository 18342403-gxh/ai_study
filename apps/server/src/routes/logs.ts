/**
 * 日志查看 API
 *
 * GET /api/logs           — 全量日志（支持 ?level=&tag=&limit= 过滤）
 * GET /api/logs/stream    — SSE 实时推送新日志
 * GET /api/logs/tags      — 所有已出现的 tag 列表（供前端 filter）
 */

import { Router } from 'express'
import { getLogs, subscribeLogs, logger, type LogLevel, type LogRecord } from '../services/logger.js'

const router = Router()

/** GET /api/logs — 历史 */
router.get('/', (req, res) => {
  const level = (req.query.level as string | undefined)?.toUpperCase() as LogLevel | undefined
  const tag = req.query.tag as string | undefined
  const limit = Number(req.query.limit) || 200
  res.json(getLogs({ level, tag, limit }))
})

/** GET /api/logs/tags */
router.get('/tags', (_req, res) => {
  const all = getLogs({ limit: 5000 })
  const tags = Array.from(new Set(all.map(r => r.tag))).sort()
  res.json(tags)
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

  const unsubscribe = subscribeLogs((rec: LogRecord) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(rec)}\n\n`)
    }
  })

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

export default router
