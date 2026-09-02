/**
 * 文档管理 API
 * POST /api/documents/upload — 上传文档（multer 处理文件 + Zod 校验可选 metadata）
 * GET  /api/documents        — 获取文档列表
 * DELETE /api/documents/:id  — 删除文档
 */

import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

import { getDb } from '../db/index.js'
import { splitIntoChunks } from '../services/chunker.js'
import { getEmbeddings } from '../services/embedding.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = Router()

// ── Zod 校验 Schema ─────────────────────────────────
const docIdParamSchema = z.object({
  id: z.string().uuid('文档 ID 必须是合法 UUID'),
})

const uploadMetadataSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
}).optional()

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

// ── 路由 ─────────────────────────────────────────────

/** POST /api/documents/upload */
router.post(
  '/upload',
  upload.single('file'),
  validate({ body: uploadMetadataSchema }),
  asyncHandler(async (req, res) => {
    const file = req.file
    if (!file) {
      throw createError('未提供上传文件', 400, 'NO_FILE')
    }

    const db = getDb()
    const docId = randomUUID()
    const now = Date.now()

    db.prepare(`
      INSERT INTO documents (id, name, size, type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'processing', ?, ?)
    `).run(docId, file.originalname, file.size, path.extname(file.originalname), now, now)

    // 异步处理文档（解析 → 分块 → 向量化）
    ;(async () => {
      try {
        const text = await extractText(file.path, file.originalname)
        const chunks = splitIntoChunks(text)
        const embeddings = await getEmbeddings(chunks.map((c) => c.content))

        const insertChunk = db.prepare(`
          INSERT INTO chunks (id, doc_id, content, chunk_index, embedding)
          VALUES (?, ?, ?, ?, ?)
        `)

        const insertMany = db.transaction(() => {
          for (let i = 0; i < chunks.length; i++) {
            insertChunk.run(
              randomUUID(),
              docId,
              chunks[i].content,
              chunks[i].index,
              JSON.stringify(embeddings[i])
            )
          }
        })
        insertMany()

        db.prepare(`
          UPDATE documents SET status = 'ready', chunk_count = ?, updated_at = ?
          WHERE id = ?
        `).run(chunks.length, Date.now(), docId)
      } catch {
        db.prepare(`
          UPDATE documents SET status = 'failed', updated_at = ? WHERE id = ?
        `).run(Date.now(), docId)
      }
    })()

    res.json({ id: docId, name: file.originalname, status: 'processing' })
  })
)

/** GET /api/documents */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const db = getDb()
    const documents = db.prepare('SELECT * FROM documents ORDER BY created_at DESC').all()
    res.json(documents)
  })
)

/** DELETE /api/documents/:id */
router.delete(
  '/:id',
  validate({ params: docIdParamSchema }),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const id = req.params.id

    const doc = db.prepare('SELECT id FROM documents WHERE id = ?').get(id)
    if (!doc) {
      throw createError(`文档 ${id} 不存在`, 404, 'DOC_NOT_FOUND')
    }

    db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(id)
    db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    res.json({ success: true })
  })
)

export default router
