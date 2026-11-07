/**
 * 文档管理 API
 * POST /api/documents/upload — 上传文档（multer 处理文件 + Zod 校验可选 metadata）
 * GET  /api/documents        — 获取文档列表
 * POST /api/documents/:id/extract — 文档抽取为候选记录（v5 阶段 5）
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
import { and, desc, eq, inArray } from 'drizzle-orm'

import { getDb, tables } from '../db/index.js'
import { splitStructured, getEmbeddings } from '../services/rag/index.js'
import { extractTextFromFile, isSupportedExtension } from '../services/rag/fileText.js'
import { logger } from '../services/logger.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'
import { extractDocumentChunks, MAX_DOC_CHUNKS } from '../services/extract/documentExtractor.js'
import {
  buildEntryCards,
  pickRelated,
  rowTimeText,
  rowToExisting,
} from '../services/extract/cards.js'
import type { PromptEntry } from '../services/extract/extractor.js'
import { getLocalTimezone } from '../services/extract/timeParse.js'

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

const documentExtractSchema = z.object({
  /** 不传 = 整篇；传了只抽取指定块 */
  chunkIds: z.array(z.string().min(1).max(64)).max(MAX_DOC_CHUNKS).optional(),
  libraryId: z.string().max(64).default('default'),
})

// ── Multer 文件上传配置 ─────────────────────────────
const upload = multer({
  dest: path.join(__dirname, '../../uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (isSupportedExtension(file.originalname)) {
      cb(null, true)
    } else {
      const ext = path.extname(file.originalname).toLowerCase()
      cb(createError(`不支持的文件格式: ${ext}`, 400, 'UNSUPPORTED_FILE_TYPE'))
    }
  },
})

// ── 辅助函数 ─────────────────────────────────────────
// 解析统一走 services/rag/fileText（txt / md / json / pdf / doc / docx）

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
        const text = await extractTextFromFile(file.path, file.originalname)
        // v5 统一分片（spec 4.2）：结构 → 段落 → 句子 → 硬切，600/80
        const chunks = splitStructured(text)
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

/** POST /api/documents/:id/extract — 文档抽取为候选记录（不写条目） */
router.post(
  '/:id/extract',
  validate({ params: docIdParamSchema, body: documentExtractSchema }),
  asyncHandler(async (req, res) => {
    const body = documentExtractSchema.parse(req.body ?? {})
    const docId = req.params.id
    const db = getDb()
    const nowMs = Date.now()
    const timezone = getLocalTimezone()

    const docRows = await db
      .select()
      .from(tables.documents)
      .where(eq(tables.documents.id, docId))
      .limit(1)
    const doc = docRows[0]
    if (!doc || doc.deletedAt !== null || doc.status === 'deleted') {
      throw createError(`文档 ${docId} 不存在`, 404, 'DOC_NOT_FOUND')
    }
    if (doc.status !== 'ready') {
      throw createError('文档尚未处理完成，暂时不能抽取', 409, 'DOC_NOT_READY')
    }

    const chunkConds = [eq(tables.chunks.docId, docId)]
    if (body.chunkIds && body.chunkIds.length > 0) {
      chunkConds.push(inArray(tables.chunks.id, body.chunkIds))
    }
    const chunkRows = await db
      .select()
      .from(tables.chunks)
      .where(and(...chunkConds))
      .orderBy(tables.chunks.chunkIndex)

    if (chunkRows.length === 0) {
      throw createError('没有可抽取的文档块', 400, 'NO_CHUNKS')
    }
    if (chunkRows.length > MAX_DOC_CHUNKS) {
      throw createError(`单次最多处理 ${MAX_DOC_CHUNKS} 块，请分批抽取`, 400, 'TOO_MANY_CHUNKS')
    }

    const alreadyExtracted = chunkRows.every((row) => row.extractedAt !== null)

    // 判重 / Prompt 参考：当前知识库的 active 条目
    const entryRows = await db
      .select()
      .from(tables.entries)
      .where(and(eq(tables.entries.libraryId, body.libraryId), eq(tables.entries.status, 'active')))
      .orderBy(desc(tables.entries.updatedAt))
      .limit(50)

    const related = pickRelated(
      chunkRows
        .map((row) => row.content)
        .join('\n')
        .slice(0, 2000),
      entryRows,
    )
    const promptEntries: PromptEntry[] = related.map((row) => ({
      type: row.type,
      title: row.title,
      content: row.content,
      timeText: rowTimeText(row),
    }))

    const result = await extractDocumentChunks({
      chunks: chunkRows.map((row) => ({
        id: row.id,
        chunkIndex: row.chunkIndex,
        content: row.content,
      })),
      nowMs,
      timezone,
      existingEntries: promptEntries,
    })

    // 只标记抽取成功的块，失败批次下次可以重试
    if (result.succeededChunkIds.length > 0) {
      await db
        .update(tables.chunks)
        .set({ extractedAt: new Date(nowMs) })
        .where(inArray(tables.chunks.id, result.succeededChunkIds))
    }

    const entries = await buildEntryCards(
      result.entries,
      entryRows.map(rowToExisting),
      nowMs,
      timezone,
    )

    logger.info('documents.route', 'POST /:id/extract — 完成', {
      docId,
      totalChunks: chunkRows.length,
      chunksProcessed: result.chunksProcessed,
      failedChunks: result.failedChunks,
      entryCount: entries.length,
    })

    res.json({
      ok: true,
      docId,
      docName: doc.name,
      libraryId: body.libraryId,
      entries,
      truncated: result.truncated,
      remaining: result.remaining,
      totalChunks: chunkRows.length,
      chunksProcessed: result.chunksProcessed,
      failedChunks: result.failedChunks,
      alreadyExtracted,
      source: { docId, libraryId: body.libraryId },
    })
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
