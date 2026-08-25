/**
 * RAG Step 1: Loader — 多格式文档加载器
 * 支持 txt / md / json / pdf 四种格式
 * 统一输出纯文本，方便后续 Splitter 处理
 */

import path from 'path'
import { randomUUID } from 'crypto'

export interface LoadedDocument {
  id: string
  name: string
  source: string
  content: string
  metadata: Record<string, unknown>
}

export interface LoadOptions {
  metadata?: Record<string, unknown>
}

/** 根据扩展名判断文件类型 */
function detectType(filename: string): string {
  return path.extname(filename).toLowerCase()
}

/** PDF 加载器 */
async function loadPdf(filePath: string, originalName: string): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default
  const fs = await import('fs/promises')
  const buffer = await fs.readFile(filePath)
  const data = await pdfParse(buffer)
  return data.text
}

/** 纯文本加载器（txt/md/json） */
async function loadPlain(filePath: string): Promise<string> {
  const fs = await import('fs/promises')
  return fs.readFile(filePath, 'utf-8')
}

/**
 * 从文件路径加载文档
 */
export async function loadFromFile(
  filePath: string,
  originalName?: string,
  options: LoadOptions = {}
): Promise<LoadedDocument> {
  const name = originalName || path.basename(filePath)
  const type = detectType(name)

  let content: string
  switch (type) {
    case '.pdf':
      content = await loadPdf(filePath, name)
      break
    case '.txt':
    case '.md':
    case '.json':
      content = await loadPlain(filePath)
      break
    default:
      throw new Error(`不支持的文件类型: ${type}`)
  }

  return {
    id: randomUUID(),
    name,
    source: filePath,
    content,
    metadata: {
      ...options.metadata,
      type,
      loadedAt: Date.now(),
    },
  }
}

/**
 * 从字符串加载（用于测试或直接灌入文本）
 */
export function loadFromString(text: string, name = 'inline.txt', options: LoadOptions = {}): LoadedDocument {
  return {
    id: randomUUID(),
    name,
    source: 'inline',
    content: text,
    metadata: {
      ...options.metadata,
      type: 'inline',
      loadedAt: Date.now(),
    },
  }
}
