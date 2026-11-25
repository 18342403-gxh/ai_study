/**
 * 文档语义通道 — spec 4.5.2 通道 B（文档块侧）
 *
 * 复用现有 ragService.search（向量 + BM25 → RRF），这里只做结果形状归一化。
 */

import { createRAGService, isMockMode } from '../rag/index.js'
import { tokenize } from '../rag/bm25.js'

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

export const searchDocumentsSemantic = async (
  query: string,
  k = 15,
  queryType?: 'keyword' | 'conceptual',
  libraryId?: string,
): Promise<DocChannelHit[]> => {
  const mock = isMockMode()
  const results = await createRAGService().search(
    query,
    k,
    undefined,
    'hybrid',
    queryType,
    libraryId,
  )
  // 动态 BM25 阈值：按查询 token 数缩放，避免长查询时绝对阈值过高
  const queryTokenCount = tokenize(query).length
  const minBm25 = 0.5 * Math.sqrt(Math.max(1, queryTokenCount))
  return results.flatMap((r) => {
    const docId = r.doc.metadata?.docId
    const chunkIndex = r.doc.metadata?.chunkIndex
    if (typeof docId !== 'string' || !r.doc.id) return []

    // RRF 是排名分，零相关也会拿到正分，这里按原始分做相关性兜底
    const bm25 = r.bm25Score ?? 0
    const cosine = r.vectorScore ?? 0
    // mock 模式下 hash 向量完全不可信，必须靠 BM25 token 重叠验证
    if (mock && bm25 <= 0) return []
    if (bm25 < minBm25 && (mock || cosine < MIN_COSINE)) return []

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
