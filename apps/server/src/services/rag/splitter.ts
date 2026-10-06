/**
 * RAG Step 2: Splitter — LangChain 版分块器
 *
 * 纯函数 simpleSplit 已抽到 splitterPure.ts（无 LangChain 依赖），
 * 本文件只保留 LangChain RecursiveCharacterTextSplitter 的封装。
 *
 * 测试请 import splitterPure.ts；
 * 需要高级分块策略时 import 本文件的 createSplitter()。
 */

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { randomUUID } from 'crypto'
export { simpleSplit, type TextChunk } from './splitterPure.js'

export interface SplitOptions {
  chunkSize?: number
  chunkOverlap?: number
  separators?: string[]
  metadata?: Record<string, unknown>
}

/** 中文友好的分隔符优先级 */
const DEFAULT_SEPARATORS = [
  '\n\n', // 段落
  '\n', // 换行
  '。', // 中文句号
  '！', // 中文感叹号
  '？', // 中文问号
  '；', // 中文分号
  '，', // 中文逗号（降级）
  '. ', // 英文句号空格
  '! ', // 英文感叹号
  '? ', // 英文问号
  '; ', // 英文分号
  ', ', // 英文逗号（降级）
  '', // 字符级兜底
]

/**
 * 使用 LangChain RecursiveCharacterTextSplitter 分块
 */
export function createSplitter(options: SplitOptions = {}) {
  const { chunkSize = 500, chunkOverlap = 50, separators = DEFAULT_SEPARATORS } = options

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators,
  })

  return {
    /** 分割文本为 TextChunk 数组（异步） */
    async splitText(
      text: string,
      docMetadata: Record<string, unknown> = {},
    ): Promise<import('./splitterPure.js').TextChunk[]> {
      const docs = await splitter.createDocuments([text])
      const chunks = docs as Array<{ pageContent: string; metadata: Record<string, unknown> }>
      return chunks.map((chunk, i) => ({
        id: randomUUID(),
        content: chunk.pageContent,
        index: i,
        metadata: {
          ...docMetadata,
          ...chunk.metadata,
          tokenCount: chunk.pageContent.length,
        },
      }))
    },

    /** 分割 LoadedDocument */
    async splitDocument(doc: {
      content: string
      metadata: Record<string, unknown>
    }): Promise<import('./splitterPure.js').TextChunk[]> {
      return this.splitText(doc.content, doc.metadata)
    },
  }
}
