/**
 * RAG — Embeddings 服务（m6 预留接口）
 * 用 LangChain Embeddings 抽象封装，替代原生 fetch 实现
 *
 * 当前状态：接口骨架，兼容现有 embedding.ts 的原生实现
 * 后续将用 @langchain/community 的 Embeddings 替换
 */

/** Embeddings 接口（对齐 LangChain Embeddings 抽象） */
export interface Embeddings {
  /** 将单条文本转为向量 */
  embedQuery(text: string): Promise<number[]>
  /** 批量将多条文本转为向量 */
  embedDocuments(texts: string[]): Promise<number[][]>
}

/** 创建 Embeddings 实例（当前委托给原生实现，后续替换为 LangChain） */
export const createEmbeddings = (): Embeddings => {
  // 动态导入以避免循环依赖
  return {
    async embedQuery(text: string): Promise<number[]> {
      const { getEmbedding } = await import('../embedding.js')
      return getEmbedding(text)
    },
    async embedDocuments(texts: string[]): Promise<number[][]> {
      const { getEmbeddings } = await import('../embedding.js')
      return getEmbeddings(texts)
    },
  }
}
