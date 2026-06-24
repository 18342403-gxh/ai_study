/**
 * Node BFF 中间层入口
 * 职责：API 代理（隐藏 Key）、文档处理、向量检索、知识库问答
 */

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

import { initDatabase } from './db/index.js'
import documentsRouter from './routes/documents.js'
import kbRouter from './routes/kb.js'
import chatRouter from './routes/chat.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// 中间件
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// 初始化数据库
initDatabase()

// 路由
app.use('/api/documents', documentsRouter)
app.use('/api/kb', kbRouter)
app.use('/api/chat', chatRouter)

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

app.listen(PORT, () => {
  process.stdout.write(`Server running on http://localhost:${PORT}\n`)
})
