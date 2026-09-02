/**
 * 请求日志中间件
 *
 * 每个请求生成唯一 requestId（crypto.randomUUID()），通过 X-Request-Id 头输出。
 * 日志行格式：
 *   [INFO ] abc123 GET /api/sessions 200 45.23ms
 *   [WARN ] abc124 POST /api/chat/completions 429 12.10ms
 *   [ERROR] abc125 GET /api/agent/run 500 234.56ms
 *
 * requestId 在日志、响应头、错误信息中贯穿，方便定位问题。
 */

import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

declare global {
  namespace Express {
    interface Request {
      requestId: string
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // 生成 requestId：优先从 X-Request-Id 头读取（链路追踪场景），否则新生成
  const incoming = req.header('X-Request-Id')
  const requestId = incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID()
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)

  const start = process.hrtime.bigint()

  res.on('finish', () => {
    const diffNs = Number(process.hrtime.bigint() - start)
    const ms = (diffNs / 1e6).toFixed(2)
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN ' : 'INFO '

    process.stdout.write(
      `[${level}] ${requestId} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms\n`
    )
  })

  next()
}
