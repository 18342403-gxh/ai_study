/**
 * RAG Step 3+4: VectorStore — Drizzle 统一数据访问层实现
 *
 * 设计：
 *   - 复用 chunks 表存储向量（embedding 列为 JSON 文本）
 *   - 支持添加文档、相似度搜索、删除
 *   - 为后续 SQLite-vec / pgvector 扩展预留接口
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { getDb, tables } from '../../db/index.js'
import { getEmbedding, cosineSimilarity } from './embeddings.js'

export interface VectorDoc {
  id?: string
  content: string
  metadata?: Record<string, unknown>
  embedding?: number[]
}

export interface VectorSearchResult {
  doc: VectorDoc
  score: number
}

export interface VectorStoreConfig {
  tableName?: string
}

export function createSqliteVectorStore(_config: VectorStoreConfig = {}) {
  return {
    /**
     * 添加文档（自动生成 embedding 并存入 chunks 表）
     */
    async addDocuments(docs: VectorDoc[], docId?: string): Promise<string[]> {
      const db = getDb()
      const ids: string[] = []

      const values = []
      const now = new Date()
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i]
        const id = doc.id || randomUUID()
        ids.push(id)

        const embedding = doc.embedding || (await getEmbedding(doc.content))
        values.push({
          id,
          docId: docId || id,
          content: doc.content,
          chunkIndex: i,
          embedding: JSON.stringify(embedding),
          createdAt: now,
        })
      }

      if (values.length > 0) {
        // 单条多行批量插入（≤500 行安全，避免双方言 transaction 行为差异）
        await db.insert(tables.chunks).values(values)
      }
      return ids
    },

    /**
     * 相似度搜索（基于 cosine similarity）
     */
    async similaritySearch(query: string, k = 4, docId?: string): Promise<VectorSearchResult[]> {
      const db = getDb()
      const queryEmbedding = await getEmbedding(query)

      const conds = [isNotNull(tables.chunks.embedding)]
      if (docId) conds.push(eq(tables.chunks.docId, docId))

      const rows = await db
        .select()
        .from(tables.chunks)
        .where(and(...conds))

      const scored = rows.map((row) => {
        const emb = JSON.parse(row.embedding!) as number[]
        const score = cosineSimilarity(queryEmbedding, emb)
        return {
          doc: {
            id: row.id,
            content: row.content,
            metadata: { docId: row.docId, chunkIndex: row.chunkIndex },
          },
          score,
        }
      })

      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, k)
    },

    /**
     * 删除文档（返回删除条数）
     */
    async deleteByDocId(docId: string): Promise<number> {
      const db = getDb()
      const rows = await db
        .select({ id: tables.chunks.id })
        .from(tables.chunks)
        .where(eq(tables.chunks.docId, docId))
      if (rows.length === 0) return 0
      await db.delete(tables.chunks).where(eq(tables.chunks.docId, docId))
      return rows.length
    },

    async delete(ids: string[]): Promise<void> {
      if (ids.length === 0) return
      const db = getDb()
      await db.delete(tables.chunks).where(inArray(tables.chunks.id, ids))
    },
  }
}

export type SqliteVectorStore = ReturnType<typeof createSqliteVectorStore>
