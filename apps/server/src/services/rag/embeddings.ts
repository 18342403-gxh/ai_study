/**
 * RAG — Embeddings 门面（唯一对外入口）
 *
 * 职责：
 *   1. 对外暴露 createEmbeddings()（LangChain 风格 Embeddings 接口）
 *   2. re-export embeddingGateway 的常用函数（getEmbedding / getEmbeddings / cosineSimilarity）
 *   3. 隔离 embeddingGateway 的实现细节，外部不应直接 import embeddingGateway
 */

/** Embeddings 接口（对齐 LangChain Embeddings 抽象） */
export interface Embeddings {
  /** 将单条文本转为向量 */
  embedQuery(text: string): Promise<number[]>
  /** 批量将多条文本转为向量 */
  embedDocuments(texts: string[]): Promise<number[][]>
}

/** 创建 Embeddings 实例（委托给 embeddingGateway 的原生实现） */
export const createEmbeddings = (): Embeddings => {
  return {
    async embedQuery(text: string): Promise<number[]> {
      const { getEmbedding } = await import('./embeddingGateway.js')
      return getEmbedding(text)
    },
    async embedDocuments(texts: string[]): Promise<number[][]> {
      const { getEmbeddings } = await import('./embeddingGateway.js')
      return getEmbeddings(texts)
    },
  }
}

// ── re-export embeddingGateway 的常用函数 ──────────────────────────
// 外部（routes 等）统一从这里或 rag/index.ts 访问，不再直接碰 embeddingGateway
export {
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
  hashVector,
  isMockMode,
} from './embeddingGateway.js'
