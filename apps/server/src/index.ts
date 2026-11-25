/**
 * Node BFF 中间层入口
 * 职责：API 代理（隐藏 Key）、文档处理、向量检索、知识库问答
 *
 * 架构：Express + PostgreSQL + pgvector + LangChain（自定义 Runnable）
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
import helmet from 'helmet'
import dotenv from 'dotenv'
import { exec } from 'node:child_process'

import { closeDatabase, initDatabase } from './db/index.js'
import { closeCheckpointer } from './services/graph/checkpointer.js'
import {
  requestLogger,
  errorHandler,
  notFoundHandler,
  rateLimit,
  cacheMiddleware,
  circuitBreaker,
  metricsMiddleware,
  metricsHandler,
  authenticate,
  requireAdmin,
} from './middleware/index.js'
import authRouter from './routes/auth.js'
import adminRouter from './routes/admin.js'
import documentsRouter from './routes/documents.js'
import entriesRouter from './routes/entries.js'
import extractRouter from './routes/extract.js'
import remindersRouter from './routes/reminders.js'
import searchRouter from './routes/search.js'
import kbRouter from './routes/kb.js'
import chatRouter from './routes/chat.js'
import sessionsRouter from './routes/sessions.js'
import ragRouter from './routes/rag.js'
import logsRouter from './routes/logs.js'
import costRouter from './routes/cost.js'
import plansRouter from './routes/plans.js'
import { getOpenApiSpec } from './openapi/generate.js'
import { initTracing } from './observability/tracing.js'
import { ensureAdmin } from './services/auth/users.js'
import { sweepExpiredUsers } from './services/auth/purge.js'
import { logger } from './services/logger.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

dotenv.config()

// 追踪是旁路能力：未开启 OTEL_ENABLED=1 时为 no-op
await initTracing()
await initDatabase()
await ensureAdmin()

const app = express()
const PORT = process.env.PORT || 3001
/** 默认只监听回环地址；需要对外提供服务时显式设置 HOST。 */
const HOST = process.env.HOST || '127.0.0.1'

// ── 中间件管线 ──────────────────────────────────────
// CORS：CORS_ORIGINS 配置逗号分隔白名单；未配置时只允许本机开发端口（同源/桌面端无 Origin 放行）
const corsWhitelist = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      const allowed =
        corsWhitelist.length > 0
          ? corsWhitelist.includes(origin)
          : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      // 不在白名单时直接不返回 CORS 头，由浏览器拦截，避免把错误抛进 500 管线
      callback(null, allowed)
    },
  }),
)

// 安全头（helmet）
// CSP 先开 report-only 模式，观察 Nuxt 页面是否有 inline script 被拦
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'localhost:3003'],
        styleSrc: ["'self'", "'unsafe-inline'", 'localhost:3003'],
        connectSrc: ["'self'", 'localhost:3003', 'localhost:3001'],
        imgSrc: ["'self'", 'data:', 'localhost:3003'],
        fontSrc: ["'self'", 'data:'],
      },
      reportOnly: true,
    },
  }),
)

app.use(express.json({ limit: '10mb' }))

// 生产级中间件（顺序重要）
app.use(rateLimit) // ① 限流：IP 维度令牌桶，SSE 单独配额
app.use(metricsMiddleware) // ② 监控：收集请求计数 / 延迟 / 错误率
app.use(cacheMiddleware) // ③ 缓存：LRU 内存缓存，GET 幂等接口 60s TTL
app.use(circuitBreaker) // ④ 熔断：AI 上游 3 次失败后开路 30s
app.use(requestLogger) // ⑤ 日志：带 requestId 的结构化日志
app.use(authenticate) // ⑥ 认证：除健康检查/登录接口外均需登录态

// ── 健康检查 & 指标 & OpenAPI ────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), uptime: process.uptime() })
})

app.get('/api/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.json(getOpenApiSpec())
})

app.get('/api/metrics', requireAdmin, metricsHandler)

// ── 业务路由 ────────────────────────────────────────
app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/api/chat', chatRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/documents', documentsRouter)
app.use('/api/entries', entriesRouter)
app.use('/api/extract', extractRouter)
app.use('/api/reminders', remindersRouter)
app.use('/api/search', searchRouter)
app.use('/api/kb', kbRouter)
app.use('/api/rag', ragRouter)
app.use('/api/logs', logsRouter)
app.use('/api/cost', costRouter)
app.use('/api/plans', plansRouter)

// 日志查看器 — 单文件 HTML
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.get('/api/logs-view', requireAdmin, (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/logs-view.html'))
})

// ── 错误处理（必须在所有路由之后） ────────────────────
app.use(notFoundHandler)
app.use(errorHandler)

const server = app.listen(Number(PORT), HOST, () => {
  const base = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`
  process.stdout.write(`\n╔══════════════════════════════════════╗\n`)
  process.stdout.write(`║  [BFF]  Express Server Running        ║\n`)
  process.stdout.write(`║  ${base.padEnd(36)}║\n`)
  process.stdout.write(`║  GET  /api/health     — 健康检查       ║\n`)
  process.stdout.write(`║  GET  /api/metrics    — 监控指标       ║\n`)
  process.stdout.write(`║  GET  /api/logs-view  — 📋 实时日志    ║\n`)
  process.stdout.write(`║  POST /api/auth/login — 🔐 登录        ║\n`)
  process.stdout.write(`╚══════════════════════════════════════╝\n\n`)

  // 自动打开调试页面（默认关闭；AUTO_OPEN_DEBUG_PAGES=1 开启）
  // 本地开发不想每次自动弹浏览器 — 默认关
  // 线上仓库/分享给别人方便调试 — 设 AUTO_OPEN_DEBUG_PAGES=1 默认开
  if (process.env.AUTO_OPEN_DEBUG_PAGES === '1') {
    const url = `${base}/api/logs-view`
    const cmd =
      process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
          ? `open "${url}"`
          : `xdg-open "${url}"`
    exec(cmd, () => {
      /* 忽略打开失败（WSL/无桌面环境） */
    })
  }
})

/** 每分钟扫描一次过期临时账号并销毁其知识库 */
const accountCleanupTimer = setInterval(() => {
  void sweepExpiredUsers()
    .then((count) => {
      if (count > 0) logger.info('auth.purge', '定时清理过期临时账号完成', { count })
    })
    .catch((err: Error) => logger.error('auth.purge', '定时清理任务失败', { error: err.message }))
}, 60_000)
accountCleanupTimer.unref()

/**
 * 优雅关闭：确保进行中的请求处理完成后再退出
 * 避免容器化部署（Docker/K8s）下强制 kill 导致数据不一致
 */
let shuttingDown = false
const gracefulShutdown = (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  process.stdout.write(`\n[BFF] Received ${signal}, shutting down gracefully...\n`)
  clearInterval(accountCleanupTimer)
  server.close(() => {
    void (async () => {
      try {
        await closeCheckpointer()
        await closeDatabase()
        process.stdout.write('[BFF] HTTP server and database connections closed\n')
        process.exit(0)
      } catch (error) {
        process.stderr.write(`[BFF] Failed to close resources: ${String(error)}\n`)
        process.exit(1)
      }
    })()
  })
  setTimeout(() => {
    process.stderr.write('[BFF] Forced shutdown after timeout\n')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
