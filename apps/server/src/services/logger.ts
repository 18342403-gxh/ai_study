/**
 * 全局结构化日志门面
 *
 * 使用方式：
 *   import { logger } from '../services/logger.js'
 *
 *   logger.info('generator', '开始生成', { requirement, artifactType })
 *   logger.debug('db', '执行查询', { sql: 'SELECT ...' })
 *   logger.warn('rag', '检索结果为空', { query })
 *   logger.error('agent', 'LLM 调用失败', { error: err.message })
 *
 * 输出同时到达：
 *   1. process.stdout — 终端可见（带颜色）
 *   2. LogRingBuffer  — 浏览器 GET /api/logs 查询 + SSE 实时推送
 *   3. 支持 requestId 贯穿（requestLogger 会自动注入到 async local storage）
 */

// ──────────────────────────────────────────────────
// 日志条目 + 环形缓冲区 + SSE 广播
// ──────────────────────────────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogRecord {
  id: number
  time: string             // ISO
  level: LogLevel
  tag: string              // 模块标签：generator / db / rag / http ...
  requestId?: string       // 可选，链路追踪
  message: string
  data?: unknown           // 结构化上下文（JSON 可序列化）
}

const MAX_RECORDS = 2000
const ring: LogRecord[] = []
let logSeq = 0

type Subscriber = (rec: LogRecord) => void
const subscribers = new Set<Subscriber>()

let minLevel: LogLevel = 'DEBUG' // 运行时级别，DEBUG 会打但生产可设 INFO

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }

function push(rec: LogRecord) {
  if (LEVEL_ORDER[rec.level] < LEVEL_ORDER[minLevel]) return
  ring.push(rec)
  if (ring.length > MAX_RECORDS) ring.shift()
  queueMicrotask(() => {
    for (const fn of subscribers) {
      try { fn(rec) } catch { /* 忽略订阅者异常 */ }
    }
  })
}

// ──────────────────────────────────────────────────
// 对外 API
// ──────────────────────────────────────────────────

export function getLogs(filter?: { level?: LogLevel; tag?: string; limit?: number }): LogRecord[] {
  let arr = [...ring]
  if (filter?.level) arr = arr.filter(r => r.level === filter.level)
  if (filter?.tag) arr = arr.filter(r => r.tag === filter.tag)
  if (filter?.limit && filter.limit > 0) arr = arr.slice(-filter.limit)
  return arr
}

export function subscribeLogs(fn: Subscriber): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

export function setLogLevel(level: LogLevel) {
  minLevel = level
}

// ──────────────────────────────────────────────────
// requestId 传播（通过 AsyncLocalStorage）
// ──────────────────────────────────────────────────

import { AsyncLocalStorage } from 'node:async_hooks'
const als = new AsyncLocalStorage<string>()

export function withRequestId<T>(requestId: string, fn: () => T): T {
  return als.run(requestId, fn)
}

function currentRequestId(): string | undefined {
  return als.getStore()
}

// ──────────────────────────────────────────────────
// 终端输出（带颜色）
// ──────────────────────────────────────────────────

const COLORS: Record<LogLevel, string> = {
  DEBUG: '\x1b[36m',  // 青
  INFO:  '\x1b[32m',  // 绿
  WARN:  '\x1b[33m',  // 黄
  ERROR: '\x1b[31m',  // 红
}
const RESET = '\x1b[0m'

function stdoutWrite(rec: LogRecord) {
  const time = rec.time.split('T')[1]?.replace('Z', '').slice(0, 12) ?? ''
  const req = rec.requestId ? ` ${rec.requestId.slice(0, 8)}` : ''
  const data = rec.data !== undefined ? ` ${JSON.stringify(rec.data)}` : ''
  const line = `${COLORS[rec.level]}[${rec.level}]${RESET} ${time} [${rec.tag}]${req} ${rec.message}${data}\n`
  if (rec.level === 'ERROR') process.stderr.write(line)
  else process.stdout.write(line)
}

// ──────────────────────────────────────────────────
// logger 门面
// ──────────────────────────────────────────────────

function log(level: LogLevel, tag: string, message: string, data?: unknown) {
  const rec: LogRecord = {
    id: ++logSeq,
    time: new Date().toISOString(),
    level,
    tag,
    requestId: currentRequestId(),
    message,
    data,
  }
  push(rec)
  stdoutWrite(rec)
}

export const logger = {
  debug: (tag: string, message: string, data?: unknown) => log('DEBUG', tag, message, data),
  info:  (tag: string, message: string, data?: unknown) => log('INFO',  tag, message, data),
  warn:  (tag: string, message: string, data?: unknown) => log('WARN',  tag, message, data),
  error: (tag: string, message: string, data?: unknown) => log('ERROR', tag, message, data),
}
