/**
 * doc 解析：word-extractor 优先，失败回退 mammoth
 *
 * 回退场景：.docx 被另存为 .doc 但内容仍是 OOXML 包。
 */

import type { ParseOutput } from '../types.js'
import { extractWithMammoth, extractWithWordExtractor } from './wordCommon.js'

export const parseDoc = async (buffer: Buffer): Promise<ParseOutput> => {
  try {
    const text = await extractWithWordExtractor(buffer)
    if (text.trim()) return { text, warnings: [] }
  } catch {
    // 交给下面的 OOXML 解析器兜底
  }

  try {
    const result = await extractWithMammoth(buffer)
    return { text: result.text, warnings: ['旧版 Word 解析器未成功，已回退 docx 解析'] }
  } catch {
    throw new Error('Word 文档解析失败：文件可能已损坏，或不是有效的 .doc 文件')
  }
}
