/**
 * 文档真实类型识别
 *
 * 不信任扩展名，先看文件头（magic bytes）：
 *   %PDF              → pdf
 *   PK\x03\x04 (ZIP)  → docx（识别 xlsx/pptx 后给出明确的不支持提示）
 *   D0CF11E0 (OLE2)   → doc（兼容被改名的旧版 Word）
 *   纯文本            → 按扩展名落到 txt / md / json
 *
 * 扩展名与实际内容不一致时按真实内容解析，并记录 warning，
 * 避免「.doc 改名 .docx」这类常见文件静默解析失败。
 */

import path from 'node:path'

import type { DetectionResult, DocumentKind } from './types.js'

/** 上传允许的扩展名：multer fileFilter 与解析器共用，避免两处漂移 */
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.json', '.pdf', '.doc', '.docx']

export const isSupportedExtension = (filename: string): boolean =>
  SUPPORTED_EXTENSIONS.includes(path.extname(filename).toLowerCase())

const EXTENSION_KIND: Record<string, DocumentKind> = {
  '.txt': 'txt',
  '.md': 'md',
  '.json': 'json',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
}

/** 明确不支持的 Office 格式：给出比「扩展名不支持」更可操作的提示 */
const UNSUPPORTED_OFFICE: Record<string, string> = {
  '.xlsx': 'Excel（xlsx）',
  '.xls': 'Excel（xls）',
  '.pptx': 'PowerPoint（pptx）',
  '.ppt': 'PowerPoint（ppt）',
}

const PDF_MAGIC = Buffer.from('%PDF-')
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

const startsWith = (buffer: Buffer, magic: Buffer): boolean =>
  buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic)

/** ZIP 内部条目名（OOXML 的目录名都是明文，可直接在字节里查找） */
const zipContains = (buffer: Buffer, entry: string): boolean =>
  buffer.includes(Buffer.from(entry, 'latin1'))

/** OLE 复合文档的目录项是 UTF-16LE 存储 */
const oleContains = (buffer: Buffer, name: string): boolean =>
  buffer.includes(Buffer.from(name, 'utf16le'))

/** 判断是否为二进制内容（前 8KB 出现 NUL 字节） */
const looksBinary = (buffer: Buffer): boolean => buffer.subarray(0, 8192).includes(0)

const zipKind = (buffer: Buffer): 'docx' | 'xlsx' | 'pptx' | null => {
  if (zipContains(buffer, 'word/document.xml')) return 'docx'
  if (zipContains(buffer, 'xl/workbook.xml')) return 'xlsx'
  if (zipContains(buffer, 'ppt/presentation.xml')) return 'pptx'
  return null
}

const oleKind = (buffer: Buffer): 'doc' | 'xls' | 'ppt' | null => {
  if (oleContains(buffer, 'WordDocument')) return 'doc'
  if (oleContains(buffer, 'Workbook') || oleContains(buffer, 'Book')) return 'xls'
  if (oleContains(buffer, 'PowerPoint Document')) return 'ppt'
  return null
}

const KIND_LABEL: Record<DocumentKind, string> = {
  txt: '文本',
  md: 'Markdown',
  json: 'JSON',
  pdf: 'PDF',
  docx: 'Word（docx）',
  doc: 'Word（doc）',
}

const mismatchWarning = (declared: string, actual: DocumentKind): string =>
  `扩展名为 ${declared}，实际内容为 ${KIND_LABEL[actual]}，已按实际格式解析`

export const detectDocumentKind = (buffer: Buffer, filename: string): DetectionResult => {
  if (buffer.length === 0) throw new Error('文件内容为空')

  const extension = path.extname(filename).toLowerCase()
  const declared = EXTENSION_KIND[extension]
  if (!declared) {
    const unsupported = UNSUPPORTED_OFFICE[extension]
    if (unsupported) {
      throw new Error(`暂不支持 ${unsupported} 文件，请另存为 PDF 或 CSV 后再上传`)
    }
    throw new Error(`不支持的文件类型：${extension || '无扩展名'}`)
  }

  const warnings: string[] = []

  // ── PDF ──────────────────────────────────────────
  if (startsWith(buffer, PDF_MAGIC)) {
    if (declared !== 'pdf') warnings.push(mismatchWarning(extension, 'pdf'))
    return { kind: 'pdf', extension, warnings }
  }

  // ── ZIP / OOXML ──────────────────────────────────
  if (startsWith(buffer, ZIP_MAGIC)) {
    const inner = zipKind(buffer)
    if (inner === 'xlsx') {
      throw new Error('暂不支持 Excel（xlsx）文件，请另存为 PDF 或 CSV 后再上传')
    }
    if (inner === 'pptx') {
      throw new Error('暂不支持 PowerPoint（pptx）文件，请另存为 PDF 后再上传')
    }
    if (inner === 'docx') {
      if (declared !== 'docx') warnings.push(mismatchWarning(extension, 'docx'))
      return { kind: 'docx', extension, warnings }
    }
    throw new Error('ZIP 压缩包中没有找到 Word 正文，可能不是有效的 .docx 文件')
  }

  // ── OLE2（旧版 Office）───────────────────────────
  if (startsWith(buffer, OLE_MAGIC)) {
    const inner = oleKind(buffer)
    if (inner === 'xls') {
      throw new Error('暂不支持 Excel（xls）文件，请另存为 PDF 或 CSV 后再上传')
    }
    if (inner === 'ppt') {
      throw new Error('暂不支持 PowerPoint（ppt）文件，请另存为 PDF 后再上传')
    }
    if (declared !== 'doc') warnings.push(mismatchWarning(extension, 'doc'))
    return { kind: 'doc', extension, warnings }
  }

  // ── 非容器格式：扩展名声明为 PDF/Word 但内容对不上 ──
  if (declared === 'pdf') {
    throw new Error('文件内容不是有效的 PDF（扩展名与实际格式不一致）')
  }
  if (declared === 'docx' || declared === 'doc') {
    throw new Error('文件内容不是有效的 Word 文档（扩展名与实际格式不一致），请确认文件未损坏')
  }

  if (looksBinary(buffer)) {
    throw new Error('文件包含二进制数据，不是可解析的文本文件')
  }

  return { kind: declared, extension, warnings }
}
