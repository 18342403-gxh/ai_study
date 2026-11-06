/**
 * RAG API 路由
 * POST /api/rag/documents         — 文件上传（Loader + Splitter + Embeddings + VectorStore）
 * POST /api/rag/documents/url    — URL 导入（fetch 网页 → 提取文本 → 灌入向量库）
 * GET  /api/rag/documents         — 列出已入库文档
 * POST /api/rag/query             — 基于 RAG 的问答
 * DELETE /api/rag/documents/:id   — 删除文档及其向量
 */

import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { desc, eq } from 'drizzle-orm'

import { createRAGService } from '../services/rag/index.js'
import { getDb, tables } from '../db/index.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'
import { createChatChain } from '../services/chain/chatChain.js'
import { logger } from '../services/logger.js'

const router = Router()
const ragService = createRAGService()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const upload = multer({
  dest: path.join(__dirname, '../../uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.txt', '.md', '.json', '.pdf']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) cb(null, true)
    else cb(new Error(`不支持的格式: ${ext}`))
  },
})

const querySchema = z.object({
  query: z.string().trim().min(1),
  documentIds: z.array(z.string()).optional(),
  topK: z.coerce.number().int().min(1).max(20).default(4),
  stream: z.boolean().default(true),
  systemPrompt: z.string().optional(),
})

const docIdParam = z.object({ id: z.string().min(1) })

/** 行 → API 对象（与 /api/documents 列表形状一致） */
type DocumentRow = typeof tables.documents.$inferSelect
const rowToDocument = (row: DocumentRow) => ({
  id: row.id,
  name: row.name,
  size: row.size,
  type: row.mimeType,
  status: row.status,
  chunk_count: row.chunkCount,
  created_at: row.createdAt.getTime(),
  updated_at: row.updatedAt.getTime(),
  user_id: row.userId,
  library_id: row.libraryId,
})

/** POST /api/rag/documents — 上传入库 */
router.post(
  '/documents',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = req.file
    if (!file) throw createError('未提供文件', 400)

    const db = getDb()
    const now = new Date()
    const documentId = randomUUID()

    logger.info('rag.route', 'POST /documents 开始', {
      name: file.originalname,
      size: file.size,
      documentId,
    })

    // 先写入 documents 表（chunk 外键依赖）
    await db.insert(tables.documents).values({
      id: documentId,
      name: file.originalname,
      size: file.size || 0,
      mimeType: path.extname(file.originalname),
      storagePath: file.path,
      status: 'processing',
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    })

    // 灌入向量（chunk 引用 documentId）
    const t0 = Date.now()
    const doc = await ragService.ingestFromFileWithId(file.path, file.originalname, documentId)
    logger.info('rag.route', '向量灌入完成', {
      documentId,
      chunkCount: doc.chunkCount,
      costMs: Date.now() - t0,
    })

    // 更新文档状态和分块数
    await db
      .update(tables.documents)
      .set({ status: 'ready', chunkCount: doc.chunkCount, updatedAt: new Date() })
      .where(eq(tables.documents.id, documentId))

    logger.info('rag.route', 'POST /documents 完成', { documentId, chunkCount: doc.chunkCount })

    res.status(201).json({
      id: documentId,
      name: file.originalname,
      chunkCount: doc.chunkCount,
    })
  }),
)

/** POST /api/rag/documents/url — URL 导入 */
const urlImportSchema = z.object({
  url: z.string().trim().url('必须是合法的 URL'),
  name: z.string().trim().max(120).optional(),
})

router.post(
  '/documents/url',
  validate({ body: urlImportSchema }),
  asyncHandler(async (req, res) => {
    const { url, name: providedName } = req.body

    // 安全校验：只允许 http/https，禁止 file:// / ftp:// 等
    const u = new URL(url)
    if (!['http:', 'https:'].includes(u.protocol)) {
      throw createError('只支持 http / https URL', 400, 'INVALID_PROTOCOL')
    }

    const db = getDb()
    const now = new Date()
    const documentId = randomUUID()

    logger.info('rag.route', 'POST /documents/url 开始', { url, providedName, documentId })

    // 先写 DB 记录（URL 导入：storage_path 存 URL，mime_type 存 '.url'）
    await db.insert(tables.documents).values({
      id: documentId,
      name: providedName || url.slice(0, 120),
      size: 0,
      mimeType: '.url',
      storagePath: url,
      status: 'processing',
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    })

    try {
      // 灌入向量
      const t0 = Date.now()
      const doc = await ragService.ingestFromUrlWithId(url, providedName, documentId)
      const costMs = Date.now() - t0

      // 取实际文档大小用于更新
      const contentSize = doc.chunks.reduce((s, c) => s + (c.content.length || 0), 0)

      // 更新文档状态和分块数（有标题才覆盖 name，等价旧 COALESCE 逻辑）
      const title = (doc.chunks[0]?.metadata?.title as string | undefined) || providedName
      await db
        .update(tables.documents)
        .set({
          status: 'ready',
          chunkCount: doc.chunkCount,
          size: contentSize,
          ...(title ? { name: title } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tables.documents.id, documentId))

      logger.info('rag.route', 'POST /documents/url 完成', {
        documentId,
        chunkCount: doc.chunkCount,
        costMs,
        url,
      })

      res.status(201).json({
        id: documentId,
        name: providedName || doc.chunks[0]?.metadata?.title || url.slice(0, 80),
        chunkCount: doc.chunkCount,
        url,
      })
    } catch (err) {
      // 失败也要更新状态
      const errorMsg = (err as Error).message
      logger.error('rag.route', 'POST /documents/url 失败', { documentId, url, error: errorMsg })
      await db
        .update(tables.documents)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(tables.documents.id, documentId))
      throw createError(`URL 导入失败: ${errorMsg}`, 400, 'URL_IMPORT_FAILED')
    }
  }),
)

/** GET /api/rag/documents */
router.get(
  '/documents',
  asyncHandler(async (_req, res) => {
    const db = getDb()
    const rows = await db.select().from(tables.documents).orderBy(desc(tables.documents.createdAt))
    res.json(rows.map(rowToDocument))
  }),
)

/** POST /api/rag/query */
router.post(
  '/query',
  validate({ body: querySchema }),
  asyncHandler(async (req, res) => {
    const { query, documentIds, topK, stream, systemPrompt } = req.body

    logger.info('rag.route', 'POST /query 开始', { topK, stream, queryLen: query.length })

    const results = await ragService.search(query, topK, documentIds?.[0])
    logger.info('rag.route', '检索完成', { referenceCount: results.length })

    const defaultSystem = `你是一个 RAG 问答助手。根据检索到的上下文回答问题。
如果上下文包含答案，基于内容回答并在相关句末标注 [1][2] 等引用编号。
如果上下文没有相关信息，诚实告知用户。

上下文：
${results.map((r, i) => `[${i + 1}] ${r.doc.content}`).join('\n\n')}`

    const chain = createChatChain({ temperature: 0.3, feature: 'rag' })
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt || defaultSystem },
      { role: 'user', content: query },
    ]

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      // 先发检索结果元数据
      res.write(
        `data: ${JSON.stringify({
          type: 'retrieval',
          sources: results.map((r, i) => ({
            index: i + 1,
            content: r.doc.content.slice(0, 200),
            score: Math.round(r.score * 1000) / 1000,
            metadata: r.doc.metadata,
          })),
        })}\n\n`,
      )

      try {
        for await (const delta of chain.stream({ messages, stream: true })) {
          res.write(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`)
        }
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
        logger.info('rag.route', 'POST /query 完成（stream）')
      } catch (err) {
        logger.error('rag.route', 'POST /query 失败', { error: (err as Error).message })
        if (!res.headersSent) throw err
        res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`)
      }
      res.end()
    } else {
      const answer = await chain.invoke({
        messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      })
      logger.info('rag.route', 'POST /query 完成（invoke）')
      res.json({
        answer: answer.content,
        sources: results.map((r, i) => ({
          index: i + 1,
          content: r.doc.content,
          score: r.score,
        })),
      })
    }
  }),
)

/** DELETE /api/rag/documents/:id */
router.delete(
  '/documents/:id',
  validate({ params: docIdParam }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const id = req.params.id

    logger.info('rag.route', 'DELETE /documents/:id 开始', { documentId: id })

    // 删除向量
    await ragService.deleteDocument(id)

    // 删除记录
    await db.delete(tables.documents).where(eq(tables.documents.id, id))

    logger.info('rag.route', 'DELETE /documents/:id 完成', { documentId: id })
    res.status(204).end()
  }),
)

export default router
