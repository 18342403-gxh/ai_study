/**
 * 文档解析注册表 — 上传链路唯一入口
 *
 * 流程：真实类型识别（detect）→ 按格式分派解析器 → 统一归一化 → 空内容校验。
 *
 * 每种格式独立实现：
 *   txt / md / json → parsers/text.ts（编码识别 + GB18030 回退）
 *   pdf             → parsers/pdf.ts（文字层检查 + 超时）
 *   docx            → parsers/docx.ts（mammoth，回退 word-extractor）
 *   doc             → parsers/doc.ts（word-extractor，回退 mammoth）
 */

import { readFile } from 'node:fs/promises'

import type { DocumentKind, DocumentParser, ParsedDocument } from './types.js'
import { detectDocumentKind, SUPPORTED_EXTENSIONS, isSupportedExtension } from './detect.js'
import { parseDoc } from './parsers/doc.js'
import { parseDocx } from './parsers/docx.js'
import { parsePdf } from './parsers/pdf.js'
import { parseText } from './parsers/text.js'

const PARSERS: Record<DocumentKind, DocumentParser> = {
  txt: parseText,
  md: parseText,
  json: parseText,
  pdf: parsePdf,
  docx: parseDocx,
  doc: parseDoc,
}

const EMPTY_MESSAGE: Record<DocumentKind, string> = {
  txt: '文本文件没有可提取的内容',
  md: 'Markdown 文件没有可提取的内容',
  json: 'JSON 文件没有可提取的内容',
  pdf: 'PDF 未提取到文字（可能是扫描件或图片型 PDF，需要 OCR）',
  docx: 'Word 文档没有可提取的正文',
  doc: 'Word 文档没有可提取的正文',
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/**
 * 折叠 CJK 字符之间的空白。
 * PDF 文字层提取常出现「龚 熙 皓」「项 目 经 验」这种单字间插空格，
 * 既影响展示阅读，也会让 BM25 分词退化成单字、匹配不上连续查询。
 */
const CJK = '[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]'
const CJK_SPACE_RE = new RegExp(`(${CJK})[ \\t]+(${CJK})`)
const collapseCjkSpaces = (text: string): string => {
  let result = text
  let prev: string
  do {
    prev = result
    result = result.replace(CJK_SPACE_RE, '$1$2')
  } while (prev !== result)
  return result
}

/** 去 BOM、CRLF → LF、压缩多余空行、折叠 CJK 间空格、去首尾空白 */
const normalize = (text: string): string =>
  collapseCjkSpaces(
    stripBom(text)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n'),
  ).trim()

export const extractDocument = async (
  buffer: Buffer,
  filename: string,
): Promise<ParsedDocument> => {
  const detection = detectDocumentKind(buffer, filename)
  const parser = PARSERS[detection.kind]
  const output = await parser(buffer)

  const text = normalize(output.text)
  if (!text) throw new Error(EMPTY_MESSAGE[detection.kind])

  return {
    text,
    kind: detection.kind,
    extension: detection.extension,
    chars: text.length,
    warnings: [...detection.warnings, ...output.warnings],
  }
}

/** 兼容旧调用：只要纯文本 */
export const extractTextFromBuffer = async (buffer: Buffer, filename: string): Promise<string> =>
  (await extractDocument(buffer, filename)).text

/** 兼容旧调用：从磁盘读取后解析 */
export const extractTextFromFile = async (filePath: string, filename: string): Promise<string> =>
  (await extractDocument(await readFile(filePath), filename)).text

export { SUPPORTED_EXTENSIONS, isSupportedExtension, detectDocumentKind }
export type { DocumentKind, ParsedDocument }
