/**
 * 文档管理 API
 * POST /api/documents/upload — 上传文档（multer 处理文件 + Zod 校验可选 metadata）
 * GET  /api/documents        — 获取文档列表
 * DELETE /api/documents/:id  — 删除文档
 *
 * 约定：
 *   - API 出入参保持旧形状：snake_case 字段 + 毫秒时间戳
 *   - 列表/详情的 type 字段映射自 DB 的 mime_type 列（兼容旧 SQLite 形状）
 */

import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { desc, eq } from 'drizzle-orm'

import { getDb, tables } from '../db/index.js'
import { simpleSplit, getEmbeddings } from '../services/rag/index.js'
import { logger } from '../services/logger.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = Router()

// ── Zod 校验 Schema ─────────────────────────────────
const docIdParamSchema = z.object({
  id: z.string().uuid('文档 ID 必须是合法 UUID'),
})

const uploadMetadataSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
  })
  .optional()

// ── Multer 文件上传配置 ─────────────────────────────
const upload = multer({
  dest: path.join(__dirname, '../../uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowedExts = ['.txt', '.md', '.json', '.pdf']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowedExts.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error(`不支持的文件格式: ${ext}`))
    }
  },
})

// ── 辅助函数 ─────────────────────────────────────────
const extractText = async (filePath: string, originalName: string): Promise<string> => {
  const ext = path.extname(originalName).toLowerCase()
  const fs = await import('fs/promises')

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default
    const buffer = await fs.readFile(filePath)
    const data = await pdfParse(buffer)
    return data.text
  }

  return fs.readFile(filePath, 'utf-8')
}

// ── 行 → API 对象映射（snake_case + 毫秒时间戳） ──────────

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

// ── 路由 ─────────────────────────────────────────────

/** POST /api/documents/upload */
router.post(
  '/upload',
  upload.single('file'),
  validate({ body: uploadMetadataSchema }),
  asyncHandler(async (req, res) => {
    logger.info('documents.route', 'POST /upload — 入口')
    const file = req.file
    if (!file) {
      throw createError('未提供上传文件', 400, 'NO_FILE')
    }

    const db = getDb()
    const docId = randomUUID()
    const now = new Date()

    await db.insert(tables.documents).values({
      id: docId,
      name: file.originalname,
      size: file.size,
      mimeType: path.extname(file.originalname),
      storagePath: file.path,
      status: 'processing',
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    })

    // 异步处理文档（解析 → 分块 → 向量化）
    ;(async () => {
      try {
        const text = await extractText(file.path, file.originalname)
        const chunks = simpleSplit(text, 800, 100)
        const embeddings = await getEmbeddings(chunks.map((c) => c.content))

        await db.insert(tables.chunks).values(
          chunks.map((chunk, i) => ({
            id: randomUUID(),
            docId,
            content: chunk.content,
            chunkIndex: chunk.index,
            embedding: JSON.stringify(embeddings[i]),
            createdAt: new Date(),
          })),
        )

        await db
          .update(tables.documents)
          .set({ status: 'ready', chunkCount: chunks.length, updatedAt: new Date() })
          .where(eq(tables.documents.id, docId))
        logger.info('documents.route', 'POST /upload — 后台处理完成', {
          docId,
          chunkCount: chunks.length,
        })
      } catch (err) {
        await db
          .update(tables.documents)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(tables.documents.id, docId))
        logger.error('documents.route', 'POST /upload — 后台处理失败', {
          docId,
          error: (err as Error).message,
        })
      }
    })()

    logger.info('documents.route', 'POST /upload — 出口', { docId, fileName: file.originalname })
    res.json({ id: docId, name: file.originalname, status: 'processing' })
  }),
)

/** GET /api/documents */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    logger.info('documents.route', 'GET / — 入口')
    const db = getDb()
    const rows = await db.select().from(tables.documents).orderBy(desc(tables.documents.createdAt))
    logger.info('documents.route', 'GET / — 出口', { count: rows.length })
    res.json(rows.map(rowToDocument))
  }),
)

/** DELETE /api/documents/:id */
router.delete(
  '/:id',
  validate({ params: docIdParamSchema }),
  asyncHandler(async (req, res) => {
    logger.info('documents.route', 'DELETE /:id — 入口', { id: req.params.id })
    const db = getDb()
    const id = req.params.id

    const rows = await db
      .select({ id: tables.documents.id })
      .from(tables.documents)
      .where(eq(tables.documents.id, id))
      .limit(1)
    if (!rows[0]) {
      throw createError(`文档 ${id} 不存在`, 404, 'DOC_NOT_FOUND')
    }

    await db.delete(tables.chunks).where(eq(tables.chunks.docId, id))
    await db.delete(tables.documents).where(eq(tables.documents.id, id))
    logger.info('documents.route', 'DELETE /:id — 出口', { id })
    res.json({ success: true })
  }),
)

export default router
