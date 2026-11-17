/**
 * docx 解析：mammoth 优先，失败回退 word-extractor
 *
 * 回退场景：.doc 被改名成 .docx（实际是 OLE2），mammoth 会直接报错。
 */

import type { ParseOutput } from '../types.js'
import { extractWithMammoth, extractWithWordExtractor } from './wordCommon.js'

export const parseDocx = async (buffer: Buffer): Promise<ParseOutput> => {
  try {
    const result = await extractWithMammoth(buffer)
    if (result.text.trim()) return result
  } catch {
    // 交给下面的旧版 Word 解析器兜底
  }

  try {
    const text = await extractWithWordExtractor(buffer)
    return { text, warnings: ['docx 专用解析器未成功，已回退旧版 Word 解析'] }
  } catch {
    throw new Error('Word 文档解析失败：文件可能已损坏，或不是有效的 .docx 文件')
  }
}
