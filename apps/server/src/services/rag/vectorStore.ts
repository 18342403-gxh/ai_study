/**
 * PostgreSQL + pgvector 文档向量存储。
 * 向量直接写入 vector(1536)，相似度过滤、排序与 LIMIT 均在数据库内完成。
 */

import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { getDb, tables } from '../../db/index.js'
import { getEmbedding } from './embeddings.js'

export interface VectorDoc {
  id?: string
  content: string
  metadata?: Record<string, unknown>
  embedding?: number[]
  /** 向量血缘：real=真实 API，hash=降级伪向量 */
  embeddingType?: 'real' | 'hash'
  /** 生成该向量的模型名 */
  embeddingModel?: string
}

export interface VectorSearchResult {
  doc: VectorDoc
  score: number
}

export interface VectorStoreConfig {
  tableName?: string
}

export function createPgVectorStore(_config: VectorStoreConfig = {}) {
  return {
    async addDocuments(docs: VectorDoc[], docId?: string): Promise<string[]> {
      const db = getDb()
      const ids: string[] = []
      const values: (typeof tables.chunks.$inferInsert)[] = []
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
          tokenCount: (doc.metadata?.tokenCount as number | undefined) ?? undefined,
          embedding,
          embeddingType: doc.embeddingType ?? 'real',
          embeddingModel: doc.embeddingModel ?? 'embedding-3',
          createdAt: now,
        })
      }

      if (values.length > 0) {
        await db.insert(tables.chunks).values(values)
      }
      return ids
    },

    async similaritySearch(
      query: string,
      k = 4,
      docId?: string,
      libraryId?: string,
    ): Promise<VectorSearchResult[]> {
      const db = getDb()
      const queryEmbedding = await getEmbedding(query)
      const queryVector = sql`${JSON.stringify(queryEmbedding)}::vector(1536)`
      const distance = sql`${tables.chunks.embedding} <=> ${queryVector}`

      const selection = {
        id: tables.chunks.id,
        content: tables.chunks.content,
        docId: tables.chunks.docId,
        chunkIndex: tables.chunks.chunkIndex,
        score: sql<number>`1 - (${distance})`,
      }
      const conds = [
        isNotNull(tables.chunks.embedding),
        docId ? eq(tables.chunks.docId, docId) : undefined,
      ]

      // 指定知识库时只在该库的文档内检索，避免跨租户命中
      const rows = libraryId
        ? await db
            .select(selection)
            .from(tables.chunks)
            .innerJoin(tables.documents, eq(tables.chunks.docId, tables.documents.id))
            .where(
              and(
                ...conds,
                eq(tables.documents.libraryId, libraryId),
                isNull(tables.documents.deletedAt),
              ),
            )
            .orderBy(asc(distance))
            .limit(k)
        : await db
            .select(selection)
            .from(tables.chunks)
            .where(and(...conds))
            .orderBy(asc(distance))
            .limit(k)

      return rows.map((row) => ({
        doc: {
          id: row.id,
          content: row.content,
          metadata: { docId: row.docId, chunkIndex: row.chunkIndex },
        },
        score: Number(row.score),
      }))
    },

    async deleteByDocId(docId: string): Promise<number> {
      const rows = await getDb()
        .delete(tables.chunks)
        .where(eq(tables.chunks.docId, docId))
        .returning({ id: tables.chunks.id })
      return rows.length
    },

    async delete(ids: string[]): Promise<void> {
      if (ids.length === 0) return
      await getDb().delete(tables.chunks).where(inArray(tables.chunks.id, ids))
    },
  }
}

export type PgVectorStore = ReturnType<typeof createPgVectorStore>
