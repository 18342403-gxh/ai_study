/**
 * 请求日志中间件 + 内存环形缓冲区
 *
 * 输出同时到达两个地方：
 *   1. process.stdout — 终端可见
 *   2. LogRingBuffer  — 供 GET /api/logs 查询 & SSE 推送
 *
 * 日志行格式：
 *   [INFO ] abc123 GET /api/sessions 200 45.23ms
 *   [WARN ] abc124 POST /api/chat/completions 429 12.10ms
 *   [ERROR] abc125 GET /api/agent/run 500 234.56ms
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

// ──────────────────────────────────────────────────
// 环形缓冲区 + SSE 广播
// ──────────────────────────────────────────────────

export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface LogEntry {
  id: number
  time: string           // ISO
  level: LogLevel
  requestId: string
  method: string
  url: string
  status: number
  durationMs: number
}

const MAX_LOGS = 1000
const logBuffer: LogEntry[] = []
let logSeq = 0

type LogSubscriber = (entry: LogEntry) => void
const subscribers = new Set<LogSubscriber>()

function pushLog(entry: LogEntry) {
  logBuffer.push(entry)
  if (logBuffer.length > MAX_LOGS) logBuffer.shift()
  // 异步广播（不阻塞请求）
  queueMicrotask(() => {
    for (const fn of subscribers) {
      try { fn(entry) } catch { /* 订阅者自身问题不影响其他 */ }
    }
  })
}

export function getLogs(filter?: { level?: LogLevel; limit?: number }): LogEntry[] {
  let arr = filter?.level ? logBuffer.filter(l => l.level === filter.level) : [...logBuffer]
  if (filter?.limit && filter.limit > 0) arr = arr.slice(-filter.limit)
  return arr
}

export function subscribeLogs(fn: LogSubscriber): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
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
    const ms = (diffNs / 1e6).toFixed(2)
    const status = res.statusCode
    const level: LogLevel = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO'

    // stdout（兼容原格式）
    process.stdout.write(
      `[${level}] ${requestId} ${req.method} ${req.originalUrl} ${status} ${ms}ms\n`
    )

    // 环形缓冲区（供浏览器查看）
    const entry: LogEntry = {
      id: ++logSeq,
      time: new Date().toISOString(),
      level,
      requestId,
      method: req.method,
      url: req.originalUrl,
      status,
      durationMs: Number(ms),
    }
    pushLog(entry)
  })

  next()
}
