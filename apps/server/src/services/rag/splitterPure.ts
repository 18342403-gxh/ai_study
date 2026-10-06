/**
 * 纯文本分块 — 无 LangChain 依赖
 *
 * simpleSplit 的逻辑与 splitter.ts 里的 simpleSplit 完全一致，
 * 但这个文件只导出纯函数，不 import LangChain。
 * 测试和 routes 可以安全 import 这里而不拉进整个 LangChain 依赖树。
 */

export interface TextChunk {
  id: string
  content: string
  index: number
  metadata: Record<string, unknown>
}

/**
 * 简化版分块器：按固定字符长度硬切 + 重叠窗口
 * 足够覆盖大多数 RAG demo 场景（比 chunker.ts 更强因为多了 metadata）
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
