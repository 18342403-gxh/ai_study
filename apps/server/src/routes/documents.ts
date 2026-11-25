/**
 * 文档管理 API
 * POST /api/documents/upload — 上传文档（multer 处理文件 + Zod 校验可选 metadata）
 * GET  /api/documents        — 获取文档列表
 * POST /api/documents/:id/extract — 文档抽取为候选记录（v5 阶段 5）
 * DELETE /api/documents/:id  — 删除文档
 *
 * 约定：
 *   - API 出入参保持旧形状：snake_case 字段 + 毫秒时间戳
 *   - 列表/详情的 type 字段映射自 DB 的 mime_type 列
 */

import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import path from 'path'
import { readFile, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'

import { getDb, tables } from '../db/index.js'
import {
  splitStructured,
  getEmbeddingsWithMeta,
  createPgVectorStore,
} from '../services/rag/index.js'
import { extractDocument, isSupportedExtension } from '../services/documents/index.js'
import { logger } from '../services/logger.js'
import { validate, asyncHandler, createError, requireUser } from '../middleware/index.js'
import { extractDocumentChunks, MAX_DOC_CHUNKS } from '../services/extract/documentExtractor.js'
import {
  buildEntryCards,
  pickRelated,
  rowTimeText,
  rowToExisting,
} from '../services/extract/cards.js'
import type { PromptEntry } from '../services/extract/extractor.js'
import { getLocalTimezone } from '../services/extract/timeParse.js'
import { isGraphEnabled } from '../services/graph/runtime.js'
import { runDocumentDraftGraph } from '../services/extract/graph.js'

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'embedding-3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = Router()

// ── Zod 校验 Schema ─────────────────────────────────
const docIdParamSchema = z.object({
  id: z.string().uuid('文档 ID 必须是合法 UUID'),
})

const uploadMetadataSchema = z
  .object({
    /** 展示用文件名（可选，例如 PDF 提取为 txt 后仍显示原 PDF 名） */
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
    /** 展示用文档类型（可选），用于覆盖解析器自动识别的 kind */
    kind: z.enum(['txt', 'md', 'json', 'pdf', 'docx', 'doc']).optional(),
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
    // busboy 默认按 latin1 解析 multipart 文件名，中文名会变乱码，这里转回 UTF-8
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8')
    if (isSupportedExtension(file.originalname)) {
      cb(null, true)
    } else {
      const ext = path.extname(file.originalname).toLowerCase()
      cb(createError(`不支持的文件格式: ${ext}`, 400, 'UNSUPPORTED_FILE_TYPE'))
    }
  },
})

// ── 辅助函数 ─────────────────────────────────────────
// 解析统一走 services/documents（每种格式独立解析器）

/** 单篇文档处理超时：超过说明解析器卡死，必须落 failed 而不是永远 processing */
const PROCESS_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(process.env.DOC_PROCESS_TIMEOUT_MS || '120000', 10) || 120_000,
)

/** 服务重启 / 崩溃后遗留的 processing 记录，超过该时长视为中断 */
const STALE_PROCESSING_MS = Math.max(
  30_000,
  Number.parseInt(process.env.DOC_STALE_PROCESSING_MS || '180000', 10) || 180_000,
)

type DocumentMeta = Record<string, unknown>

const mergeMeta = (meta: DocumentMeta | null | undefined, patch: DocumentMeta): DocumentMeta => ({
  ...(meta ?? {}),
  ...patch,
})

/** 把解析错误分类，前端据此给出不同提示 */
const describeError = (error: unknown): { code: string; message: string } => {
  const message = (error as Error)?.message || '解析失败'
  if (message.includes('超时')) return { code: 'PARSE_TIMEOUT', message }
  if (message.includes('扫描件') || message.includes('OCR')) {
    return { code: 'SCANNED_PDF', message }
  }
  if (message.includes('不支持') || message.includes('不是有效')) {
    return { code: 'UNSUPPORTED_CONTENT', message }
  }
  return { code: 'PARSE_FAILED', message }
}

const withTimeout = async <T>(task: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`文档处理超时（超过 ${Math.round(ms / 1000)} 秒）`)),
          ms,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 解析 → 分块 → 向量化 → 落库；任何一步失败都写入可读原因 */
const processDocument = async (
  docId: string,
  filePath: string,
  fileName: string,
  kindOverride?: string,
) => {
  const db = getDb()
  try {
    const buffer = await readFile(filePath)
    const parsed = await withTimeout(extractDocument(buffer, fileName), PROCESS_TIMEOUT_MS)

    const chunks = splitStructured(parsed.text)
    const embeddingMetas = await getEmbeddingsWithMeta(chunks.map((chunk) => chunk.content))

    // 走统一向量存储层：先删旧块，再写入 pgvector 向量。
    const vectorStore = createPgVectorStore()
    await vectorStore.deleteByDocId(docId)
    await vectorStore.addDocuments(
      chunks.map((chunk, i) => ({
        id: randomUUID(),
        content: chunk.content,
        metadata: { docId, chunkIndex: chunk.index, tokenCount: chunk.metadata?.tokenCount },
        embedding: embeddingMetas[i].vector,
        embeddingType: embeddingMetas[i].type,
        embeddingModel: EMBEDDING_MODEL,
      })),
      docId,
    )

    const rows = await db
      .select({ metadata: tables.documents.metadata })
      .from(tables.documents)
      .where(eq(tables.documents.id, docId))
      .limit(1)

    await db
      .update(tables.documents)
      .set({
        status: 'ready',
        chunkCount: chunks.length,
        updatedAt: new Date(),
        metadata: mergeMeta(rows[0]?.metadata, {
          kind: kindOverride ?? parsed.kind,
          chars: parsed.chars,
          warnings: parsed.warnings,
          error: null,
          errorCode: null,
          processedAt: new Date().toISOString(),
        }),
      })
      .where(eq(tables.documents.id, docId))

    logger.info('documents.route', '后台处理完成', {
      docId,
      kind: parsed.kind,
      chars: parsed.chars,
      chunkCount: chunks.length,
      warnings: parsed.warnings.length,
    })
  } catch (error) {
    const described = describeError(error)
    const rows = await db
      .select({ metadata: tables.documents.metadata })
      .from(tables.documents)
      .where(eq(tables.documents.id, docId))
      .limit(1)

    await db
      .update(tables.documents)
      .set({
        status: 'failed',
        updatedAt: new Date(),
        metadata: mergeMeta(rows[0]?.metadata, {
          error: described.message,
          errorCode: described.code,
          failedAt: new Date().toISOString(),
        }),
      })
      .where(eq(tables.documents.id, docId))

    logger.error('documents.route', '后台处理失败', {
      docId,
      code: described.code,
      error: described.message,
    })
  }
}

/** 服务重启会让内存中的解析任务丢失，启动后第一次拉列表时修正这些僵尸记录 */
const recoverStaleProcessing = async (libraryId: string) => {
  const db = getDb()
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS)
  const rows = await db
    .select()
    .from(tables.documents)
    .where(
      and(
        eq(tables.documents.libraryId, libraryId),
        eq(tables.documents.status, 'processing'),
        lt(tables.documents.updatedAt, cutoff),
      ),
    )

  for (const row of rows) {
    await db
      .update(tables.documents)
      .set({
        status: 'failed',
        updatedAt: new Date(),
        metadata: mergeMeta(row.metadata, {
          error: '解析进程已中断（服务重启或处理超时），请点击重新解析',
          errorCode: 'PROCESS_INTERRUPTED',
          failedAt: new Date().toISOString(),
        }),
      })
      .where(eq(tables.documents.id, row.id))
    logger.warn('documents.route', '修正遗留的解析中记录', { docId: row.id, name: row.name })
  }
  return rows.length
}

// ── 行 → API 对象映射（snake_case + 毫秒时间戳） ──────────

type DocumentRow = typeof tables.documents.$inferSelect

const rowToDocument = (row: DocumentRow) => {
  const meta = (row.metadata ?? {}) as DocumentMeta
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    type: row.mimeType,
    kind: (meta.kind as string | undefined) ?? null,
    error: (meta.error as string | undefined) ?? null,
    error_code: (meta.errorCode as string | undefined) ?? null,
    warnings: (meta.warnings as string[] | undefined) ?? [],
    status: row.status,
    chunk_count: row.chunkCount,
    created_at: row.createdAt.getTime(),
    updated_at: row.updatedAt.getTime(),
    user_id: row.userId,
    library_id: row.libraryId,
  }
}

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

    const user = requireUser(req)
    const db = getDb()
    const docId = randomUUID()
    const now = new Date()

    // 展示用文件名 / 类型：默认取上传文件名；前端可覆盖（例如 PDF 提取为 txt 后仍显示原 PDF 名与 PDF 类型）
    const displayName = (req.body?.name as string | undefined) ?? file.originalname
    const kindOverride = req.body?.kind as string | undefined

    await db.insert(tables.documents).values({
      id: docId,
      userId: user.id,
      libraryId: user.libraryId,
      name: displayName,
      size: file.size,
      mimeType: path.extname(file.originalname),
      storagePath: file.path,
      status: 'processing',
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    })

    // 异步处理文档（解析 → 分块 → 向量化）；不阻塞上传响应
    // 解析仍用真实文件名（file.originalname）选择解析器，kindOverride 仅影响展示
    void processDocument(docId, file.path, file.originalname, kindOverride)

    logger.info('documents.route', 'POST /upload — 出口', { docId, fileName: displayName })
    res.json({ id: docId, name: displayName, status: 'processing' })
  }),
)

/** GET /api/documents */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    logger.info('documents.route', 'GET / — 入口')
    const user = requireUser(req)
    // 先修正服务重启遗留的僵尸 processing，前端才不会一直显示“解析中”
    await recoverStaleProcessing(user.libraryId)
    const db = getDb()
    const rows = await db
      .select()
      .from(tables.documents)
      .where(eq(tables.documents.libraryId, user.libraryId))
      .orderBy(desc(tables.documents.createdAt))
    logger.info('documents.route', 'GET / — 出口', { count: rows.length })
    res.json(rows.map(rowToDocument))
  }),
)

/** POST /api/documents/:id/reprocess — 重新解析（失败重试 / 中断恢复） */
router.post(
  '/:id/reprocess',
  validate({ params: docIdParamSchema }),
  asyncHandler(async (req, res) => {
    const id = req.params.id
    const user = requireUser(req)
    const db = getDb()

    const rows = await db
      .select()
      .from(tables.documents)
      .where(and(eq(tables.documents.id, id), eq(tables.documents.libraryId, user.libraryId)))
      .limit(1)
    const doc = rows[0]
    if (!doc) throw createError(`文档 ${id} 不存在`, 404, 'DOC_NOT_FOUND')
    if (!doc.storagePath) {
      throw createError('原始文件已不存在，请重新上传', 409, 'SOURCE_FILE_MISSING')
    }

    try {
      await readFile(doc.storagePath)
    } catch {
      throw createError('原始文件已不存在，请重新上传', 409, 'SOURCE_FILE_MISSING')
    }

    await db.delete(tables.chunks).where(eq(tables.chunks.docId, id))
    await db
      .update(tables.documents)
      .set({
        status: 'processing',
        chunkCount: 0,
        updatedAt: new Date(),
        metadata: mergeMeta(doc.metadata, { error: null, errorCode: null }),
      })
      .where(eq(tables.documents.id, id))

    void processDocument(id, doc.storagePath, doc.name)

    logger.info('documents.route', 'POST /:id/reprocess — 已开始重新解析', { id })
    res.json({ id, status: 'processing' })
  }),
)

/** POST /api/documents/:id/extract — 文档抽取为候选记录（不写条目） */
router.post(
  '/:id/extract',
  validate({ params: docIdParamSchema, body: documentExtractSchema }),
  asyncHandler(async (req, res) => {
    const body = documentExtractSchema.parse(req.body ?? {})
    const user = requireUser(req)
    const libraryId = user.libraryId
    const docId = req.params.id
    const db = getDb()
    const nowMs = Date.now()
    const timezone = getLocalTimezone()

    const docRows = await db
      .select()
      .from(tables.documents)
      .where(and(eq(tables.documents.id, docId), eq(tables.documents.libraryId, libraryId)))
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
      .where(and(eq(tables.entries.libraryId, libraryId), eq(tables.entries.status, 'active')))
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

    const summary = {
      ok: true,
      docId,
      docName: doc.name,
      libraryId,
      truncated: result.truncated,
      remaining: result.remaining,
      totalChunks: chunkRows.length,
      chunksProcessed: result.chunksProcessed,
      failedChunks: result.failedChunks,
      alreadyExtracted,
      source: { docId, libraryId },
    }

    // ── 图模式：卡片交给抽取图挂起，确认走 /api/extract/:threadId/resume ──
    if (isGraphEnabled('extract') && entries.length > 0) {
      const draft = await runDocumentDraftGraph({
        userId: user.id,
        libraryId,
        sessionId: null,
        cards: entries,
        nowMs,
        timezone,
      })
      res.json({
        ...summary,
        entries: draft.cards,
        cards: draft.cards,
        draftId: draft.draftId,
        threadId: draft.threadId,
        interrupted: true,
      })
      return
    }

    res.json({ ...summary, entries })
  }),
)

/** DELETE /api/documents/:id */
router.delete(
  '/:id',
  validate({ params: docIdParamSchema }),
  asyncHandler(async (req, res) => {
    logger.info('documents.route', 'DELETE /:id — 入口', { id: req.params.id })
    const user = requireUser(req)
    const db = getDb()
    const id = req.params.id

    const rows = await db
      .select({ id: tables.documents.id, storagePath: tables.documents.storagePath })
      .from(tables.documents)
      .where(and(eq(tables.documents.id, id), eq(tables.documents.libraryId, user.libraryId)))
      .limit(1)
    if (!rows[0]) {
      throw createError(`文档 ${id} 不存在`, 404, 'DOC_NOT_FOUND')
    }

    // 删除分块向量；随后删除文档记录。
    await createPgVectorStore().deleteByDocId(id)
    await db.delete(tables.documents).where(eq(tables.documents.id, id))

    // 同时清理磁盘原件，避免 uploads 目录无限增长
    if (rows[0].storagePath) {
      await unlink(rows[0].storagePath).catch(() => {
        /* 文件可能已被清理，忽略 */
      })
    }
    logger.info('documents.route', 'DELETE /:id — 出口', { id })
    res.json({ success: true })
  }),
)

export default router
