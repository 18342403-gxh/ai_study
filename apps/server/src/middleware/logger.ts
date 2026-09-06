/**
 * 请求日志中间件
 *
 * 每个请求生成唯一 requestId（crypto.randomUUID()），通过 X-Request-Id 头输出。
 * 日志通过 services/logger 门面写入，统一进入环形缓冲区。
 *
 * 旧接口兼容：getLogs / subscribeLogs 代理到 services/logger
 */

import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { logger, withRequestId, getLogs as getLoggerLogs, subscribeLogs as subscribeLoggerLogs, type LogLevel } from '../services/logger.js'

declare global {
  namespace Express {
    interface Request {
      requestId: string
    }
  }
}

export type { LogLevel }
export interface LogEntry {
  id: number
  time: string
  level: LogLevel
  requestId: string
  method: string
  url: string
  status: number
  durationMs: number
}

export function getLogs(filter?: { level?: LogLevel; limit?: number }): LogEntry[] {
  // 从通用日志中筛选 http 请求记录
  const all = getLoggerLogs({ level: filter?.level, limit: filter?.limit ? filter.limit * 5 : undefined })
  return all
    .filter(r => r.tag === 'http' && r.data && typeof r.data === 'object' && 'method' in (r.data as object))
    .map(r => {
      const d = r.data as Record<string, unknown>
      return {
        id: r.id,
        time: r.time,
        level: r.level,
        requestId: r.requestId ?? '',
        method: d.method as string,
        url: d.url as string,
        status: d.status as number,
        durationMs: d.durationMs as number,
      }
    })
}

export function subscribeLogs(fn: (entry: LogEntry) => void): () => void {
  return subscribeLoggerLogs(rec => {
    if (rec.tag === 'http' && rec.data && typeof rec.data === 'object' && 'method' in (rec.data as object)) {
      const d = rec.data as Record<string, unknown>
      fn({
        id: rec.id,
        time: rec.time,
        level: rec.level,
        requestId: rec.requestId ?? '',
        method: d.method as string,
        url: d.url as string,
        status: d.status as number,
        durationMs: d.durationMs as number,
      })
    }
  })
}

// ──────────────────────────────────────────────────
// 请求日志中间件
// ──────────────────────────────────────────────────

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('X-Request-Id')
  const requestId = incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID()
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)

  const start = process.hrtime.bigint()

  res.on('finish', () => {
    const diffNs = Number(process.hrtime.bigint() - start)
    const ms = Number((diffNs / 1e6).toFixed(2))
    const status = res.statusCode
    const level: LogLevel = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO'

    const tag = 'http'
    const msg = `${req.method} ${req.originalUrl} ${status} ${ms.toFixed(2)}ms`
    const data = { method: req.method, url: req.originalUrl, status, durationMs: ms }

    withRequestId(requestId, () => {
      if (level === 'ERROR') logger.error(tag, msg, data)
      else if (level === 'WARN') logger.warn(tag, msg, data)
      else logger.info(tag, msg, data)
    })
  })

  next()
}
