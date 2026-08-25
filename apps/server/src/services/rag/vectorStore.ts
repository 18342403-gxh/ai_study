/**
 * RAG Step 3+4: VectorStore — SQLite 实现（替换旧接口）
 *
 * 设计：
 *   - 复用 db/chunks 表存储向量
 *   - 支持添加文档、相似度搜索、删除
 *   - 为后续 SQLite-vec 扩展预留接口
 */

import { getDb } from '../../db/index.js'
import { getEmbedding, cosineSimilarity } from '../embedding.js'
import { randomUUID } from 'crypto'

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

export function createSqliteVectorStore(config: VectorStoreConfig = {}) {
  const tableName = config.tableName || 'chunks'

  return {
    /**
     * 添加文档（自动生成 embedding 并存入 SQLite）
     */
    async addDocuments(docs: VectorDoc[], docId?: string): Promise<string[]> {
      const db = getDb()
      const ids: string[] = []

      const insert = db.prepare(
        `INSERT INTO ${tableName} (id, doc_id, content, chunk_index, embedding)
         VALUES (?, ?, ?, ?, ?)`
      )

      const insertMany = db.transaction((items: Array<[string, string, string, number, string]>) => {
        for (const item of items) {
          insert.run(...item)
        }
      })

      const items: Array<[string, string, string, number, string]> = []
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i]
        const id = doc.id || randomUUID()
        ids.push(id)

        const embedding = doc.embedding || (await getEmbedding(doc.content))
        items.push([
          id,
          docId || id,
          doc.content,
          i,
          JSON.stringify(embedding),
        ])
      }

      insertMany(items)
      return ids
    },

    /**
     * 相似度搜索（基于 cosine similarity）
     */
    async similaritySearch(query: string, k = 4, docId?: string): Promise<VectorSearchResult[]> {
      const db = getDb()
      const queryEmbedding = await getEmbedding(query)

      let rows: Array<{ id: string; doc_id: string; content: string; chunk_index: number; embedding: string }>
      if (docId) {
        rows = db
          .prepare(
            `SELECT * FROM ${tableName} WHERE doc_id = ? AND embedding IS NOT NULL`
          )
          .all(docId) as typeof rows
      } else {
        rows = db
          .prepare(`SELECT * FROM ${tableName} WHERE embedding IS NOT NULL`)
          .all() as typeof rows
      }

      const scored = rows.map((row) => {
        const emb = JSON.parse(row.embedding) as number[]
        const score = cosineSimilarity(queryEmbedding, emb)
        return {
          doc: {
            id: row.id,
            content: row.content,
            metadata: { docId: row.doc_id, chunkIndex: row.chunk_index },
          },
          score,
        }
      })

      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, k)
    },

    /**
     * 删除文档
     */
    async deleteByDocId(docId: string): Promise<number> {
      const db = getDb()
      const result = db.prepare(`DELETE FROM ${tableName} WHERE doc_id = ?`).run(docId)
      return result.changes
    },

    async delete(ids: string[]): Promise<void> {
      const db = getDb()
      const placeholders = ids.map(() => '?').join(',')
      db.prepare(`DELETE FROM ${tableName} WHERE id IN (${placeholders})`).run(...ids)
    },
  }
}

export type SqliteVectorStore = ReturnType<typeof createSqliteVectorStore>
