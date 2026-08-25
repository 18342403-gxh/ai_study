/**
 * Node BFF 中间层入口
 * 职责：API 代理（隐藏 Key）、文档处理、向量检索、知识库问答
 *
 * 架构：Express + SQLite（better-sqlite3） + LangChain（自定义 Runnable）
 * 端口：3001（Nitro :3000 的 BFF 后端）
 */

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

import { initDatabase } from './db/index.js'
import { requestLogger, errorHandler, notFoundHandler } from './middleware/index.js'
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

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(requestLogger)

initDatabase()

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), uptime: process.uptime() })
})

app.use('/api/chat', chatRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/documents', documentsRouter)
app.use('/api/kb', kbRouter)
app.use('/api/tools', toolsRouter)
app.use('/api/rag', ragRouter)
app.use('/api/agent', agentRouter)
app.use('/api/generator', generatorRouter)

app.use(notFoundHandler)
app.use(errorHandler)

const server = app.listen(PORT, () => {
  process.stdout.write(`[BFF] Server running on http://localhost:${PORT}\n`)
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
