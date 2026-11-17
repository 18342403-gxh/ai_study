/**
 * 增量重嵌 — API 恢复后扫描 hash 向量并重新生成真实 embedding
 *
 * 触发时机：probeRealEmbedding 成功（mockUntil 清零）时。
 * 幂等：reembeddingInProgress 全局标志防止并发重复触发。
 * 容错：单文档重嵌失败保持 hash，不阻塞其他文档。
 */

import { eq } from 'drizzle-orm'

import { getDb, getSqliteRaw, isVecExtensionLoaded, tables } from '../../db/index.js'
import { getEmbeddingsWithMeta, getEmbeddingWithMeta } from './embeddings.js'
import { logger } from '../logger.js'

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'embedding-3'
const EMBEDDING_DIM = 1536

let reembeddingInProgress = false
let reembedPendingCount = 0

/** 重嵌状态（供前端轮询） */
export const getReembedStatus = (): { pending: number; inProgress: boolean } => ({
  pending: reembedPendingCount,
  inProgress: reembeddingInProgress,
})

/** 扫描并重嵌所有 embedding_type='hash' 的 chunks 与 entry_embeddings */
export const reembedHashVectors = async (): Promise<void> => {
  if (reembeddingInProgress) return
  reembeddingInProgress = true

  try {
    const db = getDb()
    const raw = getSqliteRaw()
    const useVec = isVecExtensionLoaded()

    // ── 1. 重嵌 chunks ──────────────────────────────
    const hashChunks = await db
      .select({
        id: tables.chunks.id,
        docId: tables.chunks.docId,
        content: tables.chunks.content,
      })
      .from(tables.chunks)
      .where(eq(tables.chunks.embeddingType, 'hash'))

    reembedPendingCount = hashChunks.length
    logger.info('reembed', `扫描到 ${hashChunks.length} 个 hash 文档块，开始重嵌`)

    if (hashChunks.length > 0) {
      // 按 docId 分组，逐文档重嵌（单文档失败不阻塞）
      const byDoc = new Map<string, typeof hashChunks>()
      for (const c of hashChunks) {
        const list = byDoc.get(c.docId) ?? []
        list.push(c)
        byDoc.set(c.docId, list)
      }

      let successDocs = 0
      let failedDocs = 0

      for (const [docId, chunks] of byDoc) {
        try {
          const metas = await getEmbeddingsWithMeta(chunks.map((c) => c.content))
          for (let i = 0; i < chunks.length; i++) {
            const meta = metas[i]
            await db
              .update(tables.chunks)
              .set({
                embedding: JSON.stringify(meta.vector),
                embeddingType: meta.type,
                embeddingModel: EMBEDDING_MODEL,
              })
              .where(eq(tables.chunks.id, chunks[i].id))

            // 同步更新 chunks_vec
            if (useVec && raw && meta.type === 'real' && meta.vector.length === EMBEDDING_DIM) {
              raw
                .prepare(`INSERT OR REPLACE INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)`)
                .run(chunks[i].id, Float32Array.from(meta.vector))
            }
          }
          successDocs++
        } catch (err) {
          failedDocs++
          logger.warn('reembed', `文档 ${docId} 重嵌失败，保持 hash`, {
            error: (err as Error).message.slice(0, 120),
          })
        }
      }

      logger.info('reembed', `文档块重嵌完成`, { successDocs, failedDocs })
    }

    // ── 2. 重嵌 entry_embeddings ────────────────────
    const hashEntries = await db
      .select({
        entryId: tables.entryEmbeddings.entryId,
      })
      .from(tables.entryEmbeddings)
      .where(eq(tables.entryEmbeddings.embeddingType, 'hash'))

    // 需要关联 entries 表获取 title/content
    const entryIds = hashEntries.map((e) => e.entryId)
    if (entryIds.length > 0) {
      const entries = await db
        .select({
          id: tables.entries.id,
          title: tables.entries.title,
          content: tables.entries.content,
        })
        .from(tables.entries)
        .where(eq(tables.entries.id, entryIds[0])) // 单条先查，下面循环
      // 注意：entry_embeddings 与 entries 是 1:1，直接逐条处理
      let successEntries = 0
      let failedEntries = 0

      for (const { entryId } of hashEntries) {
        try {
          const row = await db
            .select({ title: tables.entries.title, content: tables.entries.content })
            .from(tables.entries)
            .where(eq(tables.entries.id, entryId))
            .limit(1)
          if (!row[0]) continue

          const meta = await getEmbeddingWithMeta(`${row[0].title}\n${row[0].content}`)
          await db
            .update(tables.entryEmbeddings)
            .set({
              embedding: JSON.stringify(meta.vector),
              model: EMBEDDING_MODEL,
              embeddingType: meta.type,
              updatedAt: new Date(),
            })
            .where(eq(tables.entryEmbeddings.entryId, entryId))
          successEntries++
        } catch (err) {
          failedEntries++
          logger.warn('reembed', `条目 ${entryId} 重嵌失败，保持 hash`, {
            error: (err as Error).message.slice(0, 120),
          })
        }
      }

      logger.info('reembed', `条目向量重嵌完成`, { successEntries, failedEntries })
    }

    reembedPendingCount = 0
  } catch (err) {
    logger.error('reembed', '增量重嵌任务异常', { error: (err as Error).message })
  } finally {
    reembeddingInProgress = false
    reembedPendingCount = 0
  }
}
