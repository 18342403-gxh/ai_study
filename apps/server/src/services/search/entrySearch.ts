/**
 * 条目语义通道 — spec 4.5.2 通道 B（条目侧）
 *
 * 两路召回：entry_embeddings 向量 + 条目文本 BM25，RRF 融合后取 Top-K。
 * embedding 不可用时向量通道自然为空（hash 降级仍照常参与，阈值关闭）。
 */

import { and, desc, eq, inArray } from 'drizzle-orm'

import { getDb, tables } from '../../db/index.js'
import { bm25Rank } from '../rag/bm25.js'
import { cosineSimilarity, getEmbedding, isMockMode } from '../rag/index.js'
import { entryEmbeddingText } from './entryIndex.js'

type EntryRow = typeof tables.entries.$inferSelect

export interface EntrySearchHit {
  entry: EntryRow
  /** RRF 融合分（同一口径，最终排序前会按通道归一化） */
  score: number
  vectorScore?: number
  bm25Score?: number
}

export interface EntrySearchOptions {
  query: string
  libraryId?: string
  k?: number
  /** 真实 embedding 下的 cosine 下限（mock 降级时向量路整体跳过） */
  minScore?: number
}

const MAX_ENTRY_ROWS = 500
const EMBEDDING_BATCH = 400
const RRF_K = 60

const loadEmbeddings = async (entryIds: string[]): Promise<Map<string, number[]>> => {
  const db = getDb()
  const map = new Map<string, number[]>()
  for (let i = 0; i < entryIds.length; i += EMBEDDING_BATCH) {
    const batch = entryIds.slice(i, i + EMBEDDING_BATCH)
    const rows = await db
      .select({
        entryId: tables.entryEmbeddings.entryId,
        embedding: tables.entryEmbeddings.embedding,
      })
      .from(tables.entryEmbeddings)
      .where(inArray(tables.entryEmbeddings.entryId, batch))
    for (const row of rows) {
      try {
        map.set(row.entryId, JSON.parse(row.embedding) as number[])
      } catch {
        // 单条损坏不影响整体检索
      }
    }
  }
  return map
}

/** RRF 融合两路排名（k=60） */
export const rrfFuseIds = (lists: string[][], k = RRF_K): Array<{ id: string; score: number }> => {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1))
    })
  }
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}

export const searchEntriesSemantic = async (
  options: EntrySearchOptions,
): Promise<EntrySearchHit[]> => {
  const k = options.k ?? 15
  const minScore = options.minScore ?? 0.35
  const db = getDb()

  const rows = await db
    .select()
    .from(tables.entries)
    .where(
      and(
        eq(tables.entries.status, 'active'),
        options.libraryId ? eq(tables.entries.libraryId, options.libraryId) : undefined,
      ),
    )
    .orderBy(desc(tables.entries.updatedAt))
    .limit(MAX_ENTRY_ROWS)

  if (rows.length === 0) return []

  // 向量路：mock 降级时 hash 向量没有语义，直接跳过（spec 4.4.4：此时仅 BM25 有意义）
  const embeddings = isMockMode()
    ? new Map<string, number[]>()
    : await loadEmbeddings(rows.map((r) => r.id))
  const vectorScores = new Map<string, number>()
  if (embeddings.size > 0) {
    const queryVector = await getEmbedding(options.query)
    for (const [entryId, vector] of embeddings) {
      const score = cosineSimilarity(queryVector, vector)
      if (score >= minScore) vectorScores.set(entryId, score)
    }
  }
  const vectorRanked = Array.from(vectorScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, k * 3)
    .map(([id]) => id)

  // BM25 路（标题 + 内容）
  const bm25Scores = new Map<string, number>()
  for (const hit of bm25Rank(
    options.query,
    rows.map((r) => ({ id: r.id, text: entryEmbeddingText(r.title, r.content) })),
    k * 3,
  )) {
    if (hit.score > 0) bm25Scores.set(hit.id, hit.score)
  }

  const byId = new Map(rows.map((r) => [r.id, r]))
  return rrfFuseIds([
    vectorRanked,
    Array.from(bm25Scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id),
  ])
    .slice(0, k)
    .flatMap(({ id, score }) => {
      const entry = byId.get(id)
      return entry
        ? [
            {
              entry,
              score,
              vectorScore: vectorScores.get(id),
              bm25Score: bm25Scores.get(id),
            },
          ]
        : []
    })
}
