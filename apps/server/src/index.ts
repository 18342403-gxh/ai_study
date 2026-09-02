/**
 * Node BFF 中间层入口
 * 职责：API 代理（隐藏 Key）、文档处理、向量检索、知识库问答
 *
 * 架构：Express + SQLite（better-sqlite3） + LangChain（自定义 Runnable）
 * 端口：3001
 *
 * 中间件管线（生产级）：
 *   CORS → Body Parser → RateLimit → Metrics → Cache → CircuitBreaker → Logger → Routes → NotFound → ErrorHandler
 *                              ──────── 新增 ────────
 *
 * 端口：3001
 */

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

import { initDatabase } from './db/index.js'
import {
  requestLogger,
  errorHandler,
  notFoundHandler,
  rateLimit,
  cacheMiddleware,
  circuitBreaker,
  metricsMiddleware,
  metricsHandler,
} from './middleware/index.js'
import documentsRouter from './routes/documents.js'
import kbRouter from './routes/kb.js'
import chatRouter from './routes/chat.js'
import sessionsRouter from './routes/sessions.js'
import toolsRouter from './routes/tools.js'
import ragRouter from './routes/rag.js'
import agentRouter from './routes/agent.js'
import generatorRouter from './routes/generator.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// ── 中间件管线 ──────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// 生产级中间件（顺序重要）
app.use(rateLimit)          // ① 限流：IP 维度令牌桶，SSE 单独配额
app.use(metricsMiddleware)  // ② 监控：收集请求计数 / 延迟 / 错误率
app.use(cacheMiddleware)     // ③ 缓存：LRU 内存缓存，GET 幂等接口 60s TTL
app.use(circuitBreaker)     // ④ 熔断：AI 上游 3 次失败后开路 30s
app.use(requestLogger)      // ⑤ 日志：带 requestId 的结构化日志

initDatabase()

// ── 健康检查 & 指标 ────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), uptime: process.uptime() })
})

app.get('/api/metrics', metricsHandler)

// ── 业务路由 ────────────────────────────────────────
app.use('/api/chat', chatRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/documents', documentsRouter)
app.use('/api/kb', kbRouter)
app.use('/api/tools', toolsRouter)
app.use('/api/rag', ragRouter)
app.use('/api/agent', agentRouter)
app.use('/api/generator', generatorRouter)

// ── 错误处理（必须在所有路由之后） ────────────────────
app.use(notFoundHandler)
app.use(errorHandler)

const server = app.listen(PORT, () => {
  process.stdout.write(`\n╔══════════════════════════════════════╗\n`)
  process.stdout.write(`║  [BFF]  Express Server Running        ║\n`)
  process.stdout.write(`║  http://localhost:${PORT}            ║\n`)
  process.stdout.write(`║  GET  /api/health   — 健康检查         ║\n`)
  process.stdout.write(`║  GET  /api/metrics  — 监控指标         ║\n`)
  process.stdout.write(`╚══════════════════════════════════════╝\n\n`)
})

/**
 * 优雅关闭：确保进行中的请求处理完成后再退出
 * 避免容器化部署（Docker/K8s）下强制 kill 导致数据不一致
 */
const gracefulShutdown = (signal: string) => {
  process.stdout.write(`\n[BFF] Received ${signal}, shutting down gracefully...\n`)
  server.close(() => {
    process.stdout.write('[BFF] HTTP server closed\n')
    process.exit(0)
  })
  setTimeout(() => {
    process.stderr.write('[BFF] Forced shutdown after timeout\n')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
