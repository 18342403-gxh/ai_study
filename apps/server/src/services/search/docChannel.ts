/**
 * 文档语义通道 — spec 4.5.2 通道 B（文档块侧）
 *
 * 复用现有 ragService.search（向量 + BM25 → RRF），这里只做结果形状归一化。
 */

import { createRAGService, isMockMode } from '../rag/index.js'

export interface DocChannelHit {
  docId: string
  chunkId: string
  chunkIndex: number
  content: string
  score: number
  vectorScore?: number
  bm25Score?: number
}

/** 真实 embedding 下的 cosine 下限；mock 模式只能靠 BM25 命中 */
const MIN_COSINE = 0.35

export const searchDocumentsSemantic = async (query: string, k = 15): Promise<DocChannelHit[]> => {
  const mock = isMockMode()
  const results = await createRAGService().search(query, k)
  return results.flatMap((r) => {
    const docId = r.doc.metadata?.docId
    const chunkIndex = r.doc.metadata?.chunkIndex
    if (typeof docId !== 'string' || !r.doc.id) return []

    // RRF 是排名分，零相关也会拿到正分，这里按原始分做相关性兜底
    const bm25 = r.bm25Score ?? 0
    const cosine = r.vectorScore ?? 0
    if (bm25 <= 0 && (mock || cosine < MIN_COSINE)) return []

    return [
      {
        docId,
        chunkId: r.doc.id,
        chunkIndex: typeof chunkIndex === 'number' ? chunkIndex : 0,
        content: r.doc.content,
        score: r.score,
        vectorScore: r.vectorScore,
        bm25Score: r.bm25Score,
      },
    ]
  })
}
