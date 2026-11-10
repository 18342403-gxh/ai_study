/**
 * RAG Step 3+4: VectorStore — Drizzle 统一数据访问层实现
 *
 * 设计：
 *   - 复用 chunks 表存储向量（embedding 列为 JSON 文本）
 *   - 支持 sqlite-vec 扩展加速（chunks_vec 虚拟表，KNN 候选裁剪）
 *   - 扩展未加载 / isMockMode 时自动 fallback 到全表扫描 cosine
 *   - 为后续 pgvector 扩展预留接口
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { getDb, getSqliteRaw, isVecExtensionLoaded, tables } from '../../db/index.js'
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

/** embedding 维度（智谱 embedding-3） */
const EMBEDDING_DIM = 1536

export function createSqliteVectorStore(_config: VectorStoreConfig = {}) {
  return {
    /**
     * 添加文档（自动生成 embedding 并存入 chunks 表）
     * sqlite-vec 已加载时同步写入 chunks_vec 虚拟表
     */
    async addDocuments(docs: VectorDoc[], docId?: string): Promise<string[]> {
      const db = getDb()
      const raw = getSqliteRaw()
      const useVec = isVecExtensionLoaded()
      const ids: string[] = []

      const values = []
      const now = new Date()
      const vecRows: Array<{ id: string; embedding: Float32Array }> = []

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
        if (useVec && embedding.length === EMBEDDING_DIM) {
          vecRows.push({ id, embedding: Float32Array.from(embedding) })
        }
      }

      if (values.length > 0) {
        // 单条多行批量插入（≤500 行安全，避免双方言 transaction 行为差异）
        await db.insert(tables.chunks).values(values)
      }

      // 双写 chunks_vec 虚拟表（vec0 不支持批量 insert，逐行写入）
      if (useVec && raw && vecRows.length > 0) {
        const stmt = raw.prepare(
          `INSERT OR REPLACE INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)`,
        )
        const insertMany = raw.transaction((rows: typeof vecRows) => {
          for (const row of rows) stmt.run(row.id, row.embedding)
        })
        insertMany(vecRows)
      }

      return ids
    },

    /**
     * 相似度搜索
     * sqlite-vec 已加载：用 vec0 MATCH + k 候选裁剪 + vec_distance_cosine 算分
     * 否则：全表扫描 JSON.parse + cosineSimilarity（旧逻辑）
     */
    async similaritySearch(query: string, k = 4, docId?: string): Promise<VectorSearchResult[]> {
      const db = getDb()
      const raw = getSqliteRaw()
      const useVec = isVecExtensionLoaded()
      const queryEmbedding = await getEmbedding(query)

      // ── vec0 加速路径 ──────────────────────────────
      if (useVec && raw) {
        // 候选裁剪：取 k*3 条（L2 近似），再用 cosine 精排
        const candidateK = Math.max(k * 3, 10)
        const queryVec = Float32Array.from(queryEmbedding)
        const candidates = raw
          .prepare(
            `
            SELECT v.chunk_id AS id, c.content, c.doc_id, c.chunk_index,
                   vec_distance_cosine(v.embedding, ?) AS score
            FROM chunks_vec v
            JOIN chunks c ON c.id = v.chunk_id
            WHERE v.embedding MATCH ? AND k = ?
            ORDER BY score ASC
          `,
          )
          .all(queryVec, queryVec, candidateK) as Array<{
          id: string
          content: string
          doc_id: string
          chunk_index: number
          score: number
        }>

        // vec_distance_cosine 返回 L2 范数下的 cosine 距离（越小越相似），转为 similarity 分数
        // cosine 距离 = 1 - cosine_similarity，所以 score_similarity = 1 - distance
        const scored = candidates
          .map((row) => ({
            doc: {
              id: row.id,
              content: row.content,
              metadata: { docId: row.doc_id, chunkIndex: row.chunk_index },
            },
            score: 1 - row.score,
          }))
          .sort((a, b) => b.score - a.score)

        // docId 过滤（vec0 候选可能包含其他文档，需要后过滤）
        const filtered = docId
          ? scored.filter((r) => (r.doc.metadata as Record<string, unknown>).docId === docId)
          : scored
        return filtered.slice(0, k)
      }

      // ── fallback：全表扫描 ──────────────────────────
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
     * sqlite-vec 已加载时同步删除 chunks_vec 对应行
     */
    async deleteByDocId(docId: string): Promise<number> {
      const db = getDb()
      const raw = getSqliteRaw()
      const useVec = isVecExtensionLoaded()

      const rows = await db
        .select({ id: tables.chunks.id })
        .from(tables.chunks)
        .where(eq(tables.chunks.docId, docId))
      if (rows.length === 0) return 0

      // 同步删除 chunks_vec 中的向量
      if (useVec && raw && rows.length > 0) {
        const chunkIds = rows.map((r) => r.id)
        const placeholders = chunkIds.map(() => '?').join(',')
        raw.prepare(`DELETE FROM chunks_vec WHERE chunk_id IN (${placeholders})`).run(...chunkIds)
      }

      await db.delete(tables.chunks).where(eq(tables.chunks.docId, docId))
      return rows.length
    },

    async delete(ids: string[]): Promise<void> {
      if (ids.length === 0) return
      const db = getDb()
      const raw = getSqliteRaw()
      const useVec = isVecExtensionLoaded()

      if (useVec && raw) {
        const placeholders = ids.map(() => '?').join(',')
        raw.prepare(`DELETE FROM chunks_vec WHERE chunk_id IN (${placeholders})`).run(...ids)
      }
      await db.delete(tables.chunks).where(inArray(tables.chunks.id, ids))
    },
  }
}

export type SqliteVectorStore = ReturnType<typeof createSqliteVectorStore>
