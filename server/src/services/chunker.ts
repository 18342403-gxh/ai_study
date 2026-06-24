/**
 * 文档分块服务
 * 将文本按段落和大小拆分为适合向量化的块
 * 使用重叠窗口策略保证上下文完整性
 */

const MAX_CHUNK_SIZE = 800   // 每块最大字符数
const OVERLAP_SIZE = 100     // 重叠窗口大小

interface Chunk {
  content: string
  index: number
}

/** 按段落拆分文本，再合并为合适大小的块 */
export const splitIntoChunks = (text: string): Chunk[] => {
  // 先按段落拆分
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0)
  const chunks: Chunk[] = []
  let currentChunk = ''
  let chunkIndex = 0

  for (const para of paragraphs) {
    const trimmedPara = para.trim()

    // 如果单个段落就超过限制，按句子拆分
    if (trimmedPara.length > MAX_CHUNK_SIZE) {
      // 先保存当前累积的内容
      if (currentChunk.trim()) {
        chunks.push({ content: currentChunk.trim(), index: chunkIndex++ })
        currentChunk = ''
      }
      // 长段落按句号/问号/感叹号拆分
      const sentences = trimmedPara.split(/(?<=[。！？.!?\n])/)
      let sentenceChunk = ''
      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length > MAX_CHUNK_SIZE) {
          if (sentenceChunk.trim()) {
            chunks.push({ content: sentenceChunk.trim(), index: chunkIndex++ })
          }
          // 重叠窗口：保留上一块末尾的内容
          sentenceChunk = sentenceChunk.slice(-OVERLAP_SIZE) + sentence
        } else {
          sentenceChunk += sentence
        }
      }
      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk
      }
      continue
    }

    // 判断加入当前段落后是否超限
    if (currentChunk.length + trimmedPara.length + 2 > MAX_CHUNK_SIZE) {
      // 保存当前块
      chunks.push({ content: currentChunk.trim(), index: chunkIndex++ })
      // 重叠窗口
      currentChunk = currentChunk.slice(-OVERLAP_SIZE) + '\n\n' + trimmedPara
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedPara
    }
  }

  // 保存最后一块
  if (currentChunk.trim()) {
    chunks.push({ content: currentChunk.trim(), index: chunkIndex })
  }

  return chunks
}
