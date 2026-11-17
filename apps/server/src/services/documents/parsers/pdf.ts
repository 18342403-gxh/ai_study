/**
 * PDF 解析：pdf-parse
 *
 * 注意：pdf-parse 的 index.js 入口在 module.parent 为空（tsx / ESM 环境）时
 * 会误判为 debug 模式，启动即读取包内 test/data 下的样例文件 → 直接抛 ENOENT，
 * 导致所有 PDF 解析失败。这里绕过入口、直接 require 内部实现模块。
 *
 * 扫描件 / 图片型 PDF 没有文字层，提取结果为空，必须给出明确错误，
 * 不能静默标记为 ready。
 */

import { createRequire } from 'node:module'

import type { ParseOutput } from '../types.js'

const require = createRequire(import.meta.url)
const pdfParse: (buffer: Buffer) => Promise<{
  text: string
  numpages?: number
}> = require('pdf-parse/lib/pdf-parse.js')

const PDF_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.DOC_PDF_TIMEOUT_MS || '60000', 10) || 60_000,
)

const withTimeout = async <T>(task: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`PDF 解析超时（超过 ${ms / 1000} 秒）`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const parsePdf = async (buffer: Buffer): Promise<ParseOutput> => {
  let data: { text: string; numpages?: number }
  try {
    data = await withTimeout(pdfParse(buffer), PDF_TIMEOUT_MS)
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('超时')) throw err
    throw new Error(
      `PDF 解析失败：${message || '文件可能已损坏或被加密'}（加密 PDF 请先解除密码保护）`,
      { cause: err },
    )
  }

  const text = data.text ?? ''
  const warnings: string[] = []
  if (text.trim().length < 30) {
    warnings.push('PDF 文字层内容很少，可能是扫描件或图片型 PDF')
  }
  return { text, warnings }
}
