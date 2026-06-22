/**
 * RAG 模块类型定义
 */

/** 文档处理状态枚举 */
export type DocumentStatus = 'uploading' | 'parsing' | 'ready' | 'failed'

/** 上传的文档 */
export interface RagDocument {
  id: string
  name: string
  size: number
  status: DocumentStatus
  chunks: DocumentChunk[]
  createdAt: number
}

/** 文档分块 */
export interface DocumentChunk {
  id: string
  content: string
  index: number  // 在原文档中的顺序
}

/** 引用来源 */
export interface Citation {
  chunkId: string
  content: string
  source: string      // 来源文件名
  score: number       // 相关度分数 0-1
  chunkIndex: number  // 块序号
}

/** RAG 问答结果 */
export interface RagAnswer {
  answer: string
  citations: Citation[]
}
