/**
 * 条目向量维护 — spec 4.4.3 增量更新
 *
 * 条目标题/内容变化后重新生成向量并覆盖旧值；状态变化不重新向量化，
 * 检索时按 status 过滤。向量失败只记日志，不影响条目 CRUD。
 */

import { eq } from 'drizzle-orm'

import { getDb, tables } from '../../db/index.js'
import { getEmbedding } from '../rag/index.js'
import { logger } from '../logger.js'

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'embedding-3'

/** 向量化文本：标题 + 换行 + 内容（spec 4.4.2） */
export const entryEmbeddingText = (title: string, content: string): string => `${title}\n${content}`

/** 新建/更新条目后同步向量（覆盖旧值） */
export const syncEntryEmbedding = async (
  entryId: string,
  title: string,
  content: string,
): Promise<void> => {
  try {
    const vector = await getEmbedding(entryEmbeddingText(title, content))
    const db = getDb()
    // 双方言都没有统一的 upsert 语法，先删后插保证覆盖语义
    await db.delete(tables.entryEmbeddings).where(eq(tables.entryEmbeddings.entryId, entryId))
    await db.insert(tables.entryEmbeddings).values({
      entryId,
      embedding: JSON.stringify(vector),
      model: EMBEDDING_MODEL,
      updatedAt: new Date(),
    })
  } catch (err) {
    logger.warn('entryIndex', '条目向量更新失败，已跳过', {
      entryId,
      error: (err as Error).message,
    })
  }
}

/** 删除条目时清理向量（PG 无 SQLite 外键级联时也能回收） */
export const removeEntryEmbedding = async (entryId: string): Promise<void> => {
  try {
    await getDb().delete(tables.entryEmbeddings).where(eq(tables.entryEmbeddings.entryId, entryId))
  } catch (err) {
    logger.warn('entryIndex', '条目向量删除失败，已跳过', {
      entryId,
      error: (err as Error).message,
    })
  }
}
