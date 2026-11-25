/**
 * 条目语义通道：entry_embeddings pgvector + 条目文本 BM25，RRF 融合后取 Top-K。
 * mock/hash 降级时只走 BM25。
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { getDb, tables } from '../../db/index.js'
import { bm25Rank } from '../rag/bm25.js'
import { getEmbedding, isMockMode } from '../rag/index.js'

type EntryRow = typeof tables.entries.$inferSelect

export interface EntrySearchHit {
  entry: EntryRow
  score: number
  vectorScore?: number
  bm25Score?: number
}

export interface EntrySearchOptions {
  query: string
  libraryId?: string
  k?: number
  minScore?: number
}

const MAX_ENTRY_ROWS = 500
const RRF_K = 60

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
  const entryFilter = and(
    eq(tables.entries.status, 'active'),
    options.libraryId ? eq(tables.entries.libraryId, options.libraryId) : undefined,
  )

  const rows = await db
    .select()
    .from(tables.entries)
    .where(entryFilter)
    .orderBy(desc(tables.entries.updatedAt))
    .limit(MAX_ENTRY_ROWS)

  if (rows.length === 0) return []

  const vectorScores = new Map<string, number>()
  const vectorRanked: string[] = []
  if (!isMockMode()) {
    const queryVector = await getEmbedding(options.query)
    const vector = sql`${JSON.stringify(queryVector)}::vector(1536)`
    const distance = sql`${tables.entryEmbeddings.embedding} <=> ${vector}`
    const vectorRows = await db
      .select({
        entryId: tables.entryEmbeddings.entryId,
        score: sql<number>`1 - (${distance})`,
      })
      .from(tables.entryEmbeddings)
      .innerJoin(tables.entries, eq(tables.entryEmbeddings.entryId, tables.entries.id))
      .where(
        and(
          entryFilter,
          eq(tables.entryEmbeddings.embeddingType, 'real'),
          sql`1 - (${distance}) >= ${minScore}`,
        ),
      )
      .orderBy(asc(distance))
      .limit(k * 3)

    for (const row of vectorRows) {
      vectorRanked.push(row.entryId)
      vectorScores.set(row.entryId, Number(row.score))
    }
  }

  // BM25 路（标题 + 内容分字段，标题 boost 3.0）
  const bm25Scores = new Map<string, number>()
  for (const hit of bm25Rank(
    options.query,
    rows.map((row) => ({
      id: row.id,
      text: '',
      fields: [
        { text: row.title, boost: 3.0 },
        { text: row.content, boost: 1.0 },
      ],
    })),
    k * 3,
  )) {
    if (hit.score > 0) bm25Scores.set(hit.id, hit.score)
  }

  const byId = new Map(rows.map((row) => [row.id, row]))
  const missingIds = vectorRanked.filter((id) => !byId.has(id))
  if (missingIds.length > 0) {
    // 向量候选可能超出最近 500 条窗口，补取后再参与 RRF，避免旧条目丢失。
    const vectorEntries = await db
      .select()
      .from(tables.entries)
      .where(and(inArray(tables.entries.id, missingIds), entryFilter))
    for (const entry of vectorEntries) byId.set(entry.id, entry)
  }

  return rrfFuseIds([
    vectorRanked,
    Array.from(bm25Scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id),
  ])
    .slice(0, k)
    .flatMap(({ id, score }) => {
      const entry = byId.get(id)
      if (!entry) return []
      // mock 模式下 hash 向量不可信，必须 BM25 有 token 重叠才保留
      if (isMockMode() && !(bm25Scores.get(id) ?? 0)) return []
      return [
        {
          entry,
          score,
          vectorScore: vectorScores.get(id),
          bm25Score: bm25Scores.get(id),
        },
      ]
    })
}
