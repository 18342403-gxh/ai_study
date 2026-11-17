/**
 * 纯文本类解析：txt / md / json
 *
 * 编码识别顺序：BOM → UTF-8 → GB18030。
 * 中文用户大量使用 Windows 记事本保存的 GBK 文本，直接按 UTF-8 读会得到乱码，
 * 这里在 UTF-8 严格解码失败后回退 GB18030，并在 warning 中说明。
 */

import type { ParseOutput } from '../types.js'

interface DecodedText {
  text: string
  encoding: string
  warnings: string[]
}

export const decodePlainText = (buffer: Buffer): DecodedText => {
  // UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf-8'), encoding: 'utf-8', warnings: [] }
  }
  // UTF-16 LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf-16le', warnings: [] }
  }
  // UTF-16 BE BOM：交换字节序后按 LE 解码
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be', warnings: [] }
  }

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      encoding: 'utf-8',
      warnings: [],
    }
  } catch {
    try {
      return {
        text: new TextDecoder('gb18030').decode(buffer),
        encoding: 'gb18030',
        warnings: ['文件不是 UTF-8 编码，已按 GB18030 解码'],
      }
    } catch {
      throw new Error('文件编码无法识别（既不是 UTF-8 也不是 GB18030）')
    }
  }
}

export const parseText = async (buffer: Buffer): Promise<ParseOutput> => {
  const decoded = decodePlainText(buffer)
  return { text: decoded.text, warnings: decoded.warnings }
}
