/**
 * RAG Step 2: Splitter — 文本分压器
 *
 * 策略：优先使用 LangChain RecursiveCharacterTextSplitter
 *        中文场景用自定义 separators（按段落 > 句子 > 字符）
 *        兼容现有 chunker.ts 的简化实现
 */

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

export interface TextChunk {
  id: string
  content: string
  index: number
  metadata: Record<string, unknown>
}

export interface SplitOptions {
  chunkSize?: number
  chunkOverlap?: number
  separators?: string[]
  metadata?: Record<string, unknown>
}

/** 中文友好的分隔符优先级 */
const DEFAULT_SEPARATORS = [
  '\n\n',  // 段落
  '\n',    // 换行
  '。',    // 中文句号
  '！',    // 中文感叹号
  '？',    // 中文问号
  '；',    // 中文分号
  '，',    // 中文逗号（降级）
  '. ',    // 英文句号空格
  '! ',    // 英文感叹号
  '? ',    // 英文问号
  '; ',    // 英文分号
  ', ',    // 英文逗号（降级）
  '',      // 字符级兜底
]

/**
 * 使用 LangChain RecursiveCharacterTextSplitter 分块
 */
export function createSplitter(options: SplitOptions = {}) {
  const {
    chunkSize = 500,
    chunkOverlap = 50,
    separators = DEFAULT_SEPARATORS,
  } = options

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators,
  })

  return {
    /** 分割文本为 TextChunk 数组（异步） */
    async splitText(text: string, docMetadata: Record<string, unknown> = {}): Promise<TextChunk[]> {
      const docs = await splitter.createDocuments([text])
      const chunks = docs as Array<{ pageContent: string; metadata: Record<string, unknown> }>
      return chunks.map((chunk, i) => ({
        id: `chunk_${Date.now()}_${i}`,
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
    async splitDocument(doc: { content: string; metadata: Record<string, unknown> }): Promise<TextChunk[]> {
      return this.splitText(doc.content, doc.metadata)
    },
  }
}

/**
 * 简化版分块器（兼容原有 chunker.ts 的行为）
 * 按字符长度硬切，适合快速 demo
 */
export function simpleSplit(text: string, maxChunkSize = 500, overlap = 50): TextChunk[] {
  if (text.length <= maxChunkSize) {
    return [
      {
        id: `chunk_${Date.now()}_0`,
        content: text,
        index: 0,
        metadata: { tokenCount: text.length },
      },
    ]
  }

  const chunks: TextChunk[] = []
  let start = 0
  let index = 0

  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length)
    const chunk = text.slice(start, end)
    chunks.push({
      id: `chunk_${Date.now()}_${index}`,
      content: chunk,
      index,
      metadata: { tokenCount: chunk.length },
    })
    start = end - overlap
    index++
  }

  return chunks
}
