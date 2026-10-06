/**
 * RAG 编排层：将 Loader → Splitter → Embeddings → VectorStore 串联
 * 对外暴露 ingest() 和 query() 两个核心方法
 *
 * 📦 本文件是 rag 子系统的唯一对外入口（barrel）：
 *   - routes 层统一 `import { xxx } from '../services/rag/index.js'`
 *   - 不允许外部直接 import rag/ 子目录下的实现文件
 */

// ── barrel export：RAG 子系统对外的所有公共接口 ────────────────────
export { simpleSplit, createSplitter, type TextChunk, type SplitOptions } from './splitter.js'
export {
  createEmbeddings,
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
  hashVector,
  isMockMode,
  type Embeddings,
} from './embeddings.js'
export { loadFromFile, loadFromString, loadFromUrl, type LoadedDocument } from './loader.js'
export { bm25Search } from './bm25.js'
export { createSqliteVectorStore, type VectorSearchResult } from './vectorStore.js'

import { loadFromFile, loadFromString, loadFromUrl, type LoadedDocument } from './loader.js'
import { createSplitter, type TextChunk } from './splitter.js'
import { createEmbeddings } from './embeddings.js'
import { createSqliteVectorStore, type VectorSearchResult } from './vectorStore.js'
import { bm25Search, type BM25Result } from './bm25.js'
import { logger } from '../logger.js'
import { randomUUID } from 'crypto'

export interface RAGIngestResult {
  documentId: string
  chunkCount: number
  chunks: TextChunk[]
}

export interface RAGQueryResult {
  answer: string
  sources: Array<{
    docId: string
    content: string
    score: number
  }>
  chunks: VectorSearchResult['doc'][]
}

export interface HybridSearchResult {
  doc: VectorSearchResult['doc']
  score: number // RRF 融合分数（0-1 近似范围）
  vectorScore?: number // 原始 cosine similarity
  bm25Score?: number // 原始 BM25 score
  source: 'vector' | 'bm25' | 'hybrid'
}

/**
 * RRF（Reciprocal Rank Fusion）融合
 * score(d) = Σ 1/(k + rank(d))   — k=60（标准值）
 */
export function rrfFuse(
  vectorRanked: VectorSearchResult[],
  bm25Ranked: BM25Result[],
  k = 60,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>()

  vectorRanked.forEach((r, rank) => {
    const id = r.doc.id!
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1))
  })

  bm25Ranked.forEach((r, rank) => {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + rank + 1))
  })

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}

export function createRAGService() {
  const embeddings = createEmbeddings()
  const vectorStore = createSqliteVectorStore()
  const splitter = createSplitter({ chunkSize: 500, chunkOverlap: 50 })

  return {
    /**
     * 入库流程：加载 → 分割 → 向量化 → 存储
     */
    async ingestFromFile(filePath: string, originalName?: string): Promise<RAGIngestResult> {
      const doc = await loadFromFile(filePath, originalName)
      return this.ingestDocument(doc)
    },

    async ingestFromFileWithId(
      filePath: string,
      originalName: string | undefined,
      documentId: string,
    ): Promise<RAGIngestResult> {
      const doc = await loadFromFile(filePath, originalName)
      return this.ingestDocumentWithId(doc, documentId)
    },

    /**
     * 从 URL 抓取并灌入（指定 documentId，方便路由层先写 DB 记录）
     */
    async ingestFromUrlWithId(
      url: string,
      name: string | undefined,
      documentId: string,
    ): Promise<RAGIngestResult> {
      logger.info('rag.service', 'ingestFromUrlWithId — 入口', { documentId, url, name })
      const doc = await loadFromUrl(url, name)
      return this.ingestDocumentWithId(doc, documentId)
    },

    async ingestFromText(text: string, name = 'inline.txt'): Promise<RAGIngestResult> {
      const doc = loadFromString(text, name)
      return this.ingestDocument(doc)
    },

    async ingestDocument(doc: LoadedDocument): Promise<RAGIngestResult> {
      const documentId = randomUUID()
      return this.ingestDocumentWithId(doc, documentId)
    },

    async ingestDocumentWithId(doc: LoadedDocument, documentId: string): Promise<RAGIngestResult> {
      const start = Date.now()
      logger.info('rag.service', 'ingestDocumentWithId — 入口', { documentId, docName: doc.name })
      try {
        const chunks = await splitter.splitDocument(doc)

        const texts = chunks.map((c) => c.content)
        const vectors = await embeddings.embedDocuments(texts)

        const vectorDocs = chunks.map((chunk, i) => ({
          id: chunk.id,
          content: chunk.content,
          metadata: chunk.metadata,
          embedding: vectors[i],
        }))

        await vectorStore.addDocuments(vectorDocs, documentId)

        const costMs = Date.now() - start
        logger.info('rag.service', 'ingestDocumentWithId — 出口', {
          documentId,
          chunkCount: chunks.length,
          costMs,
        })

        return {
          documentId,
          chunkCount: chunks.length,
          chunks,
        }
      } catch (err) {
        const costMs = Date.now() - start
        logger.error('rag.service', 'ingestDocumentWithId — 错误', {
          documentId,
          costMs,
          error: (err as Error).message,
        })
        throw err
      }
    },

    /**
     * 检索流程：Hybrid Search（vector cosine + BM25 → RRF 融合）
     *
     * 优势：
     *   - vector 捕捉语义（"类似防抖的东西" → 能搜到 debounce 相关）
     *   - BM25 捕捉精确关键词（"Pinia store" → 必含 "Pinia" 和 "store"）
     *   - RRF 融合兼顾两者，比单一 cosine 在中英文混合场景准得多
     *
     * @param mode 'hybrid'（默认）| 'vector' | 'bm25'
     */
    async search(
      query: string,
      k = 5,
      docId?: string,
      mode: 'hybrid' | 'vector' | 'bm25' = 'hybrid',
    ): Promise<HybridSearchResult[]> {
      const start = Date.now()
      logger.info('rag.service', 'search — 入口', { k, docId, mode })
      try {
        const vectorTopK =
          mode === 'bm25' ? [] : await vectorStore.similaritySearch(query, k * 3, docId)
        const bm25TopK = mode === 'vector' ? [] : await bm25Search(query, k * 3, docId)

        let fused: Array<{ id: string; score: number }>
        let sourceLabel: 'vector' | 'bm25' | 'hybrid'

        if (mode === 'vector') {
          fused = vectorTopK.map((r, i) => ({ id: r.doc.id!, score: 1 / (60 + i + 1) }))
          sourceLabel = 'vector'
        } else if (mode === 'bm25') {
          fused = bm25TopK.map((r, i) => ({ id: r.id, score: 1 / (60 + i + 1) }))
          sourceLabel = 'bm25'
        } else {
          fused = rrfFuse(vectorTopK, bm25TopK)
          sourceLabel = 'hybrid'
        }

        // 把原始 doc 和 score 拼回来
        const vectorMap = new Map(vectorTopK.map((r) => [r.doc.id!, r]))
        const bm25Map = new Map(bm25TopK.map((r) => [r.id, r]))

        const results: HybridSearchResult[] = fused.slice(0, k).map(({ id, score }) => {
          const v = vectorMap.get(id)
          const b = bm25Map.get(id)
          const baseDoc =
            v?.doc ??
            (() => {
              // 来自纯 BM25 结果，构造一个最小 doc
              if (b) {
                return {
                  id: b.id,
                  content: b.content,
                  metadata: { docId: b.doc_id, chunkIndex: b.chunk_index },
                }
              }
              return { id, content: '', metadata: {} }
            })()

          return {
            doc: baseDoc,
            score,
            vectorScore: v?.score,
            bm25Score: b?.score,
            source: sourceLabel,
          }
        })

        const costMs = Date.now() - start
        logger.info('rag.service', 'search — 出口', {
          resultCount: results.length,
          costMs,
          mode,
          vectorCount: vectorTopK.length,
          bm25Count: bm25TopK.length,
        })

        return results
      } catch (err) {
        const costMs = Date.now() - start
        logger.error('rag.service', 'search — 错误', { costMs, error: (err as Error).message })
        throw err
      }
    },

    /**
     * 删除文档及其向量
     */
    async deleteDocument(documentId: string): Promise<number> {
      const start = Date.now()
      logger.info('rag.service', 'deleteDocument — 入口', { documentId })
      try {
        const deleted = await vectorStore.deleteByDocId(documentId)
        const costMs = Date.now() - start
        logger.info('rag.service', 'deleteDocument — 出口', { documentId, deleted, costMs })
        return deleted
      } catch (err) {
        const costMs = Date.now() - start
        logger.error('rag.service', 'deleteDocument — 错误', {
          documentId,
          costMs,
          error: (err as Error).message,
        })
        throw err
      }
    },
  }
}

export type RAGService = ReturnType<typeof createRAGService>
