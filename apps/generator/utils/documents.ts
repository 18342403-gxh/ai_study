/**
 * 文档格式配置与前端校验
 *
 * 每种格式单独定义：可接受扩展名、体积上限、提示文案、文件头校验规则。
 * 上传前先在浏览器校验，避免把明显错误的文件发给服务端再等一次失败。
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024

export type DocumentFormatKey = 'txt' | 'md' | 'json' | 'pdf' | 'docx' | 'doc'

export interface DocumentFormat {
  key: DocumentFormatKey
  label: string
  /** 展示用的短标签 */
  badge: string
  extensions: string[]
  /** 行的说明文案 */
  hint: string
  badgeClass: string
}

export const DOCUMENT_FORMATS: DocumentFormat[] = [
  {
    key: 'txt',
    label: '文本',
    badge: 'TXT',
    extensions: ['.txt'],
    hint: '纯文本，自动识别 UTF-8 / GBK 编码',
    badgeClass: 'bg-slate-100 text-slate-600',
  },
  {
    key: 'md',
    label: 'Markdown',
    badge: 'MD',
    extensions: ['.md'],
    hint: 'Markdown 按原文入库，保留标题与列表结构',
    badgeClass: 'bg-sky-50 text-sky-600',
  },
  {
    key: 'json',
    label: 'JSON',
    badge: 'JSON',
    extensions: ['.json'],
    hint: 'JSON 按原文入库，适合结构化资料',
    badgeClass: 'bg-violet-50 text-violet-600',
  },
  {
    key: 'pdf',
    label: 'PDF',
    badge: 'PDF',
    extensions: ['.pdf'],
    hint: '文字层 PDF 直接提取；扫描件自动用浏览器 OCR 识别',
    badgeClass: 'bg-rose-50 text-rose-600',
  },
  {
    key: 'docx',
    label: 'Word',
    badge: 'DOCX',
    extensions: ['.docx'],
    hint: 'Word（docx）保留段落与表格文字',
    badgeClass: 'bg-blue-50 text-blue-600',
  },
  {
    key: 'doc',
    label: 'Word 旧版',
    badge: 'DOC',
    extensions: ['.doc'],
    hint: 'Word 97-2003（doc）使用独立解析器',
    badgeClass: 'bg-indigo-50 text-indigo-600',
  },
]

export const DOC_ACCEPT = DOCUMENT_FORMATS.flatMap((item) => item.extensions).join(',')

export const DOC_LIST_HINT = DOCUMENT_FORMATS.map((item) => item.badge.toLowerCase()).join(' / ')

const extensionOf = (filename: string): string => {
  const index = filename.lastIndexOf('.')
  return index >= 0 ? filename.slice(index).toLowerCase() : ''
}

export const findDocumentFormat = (filename: string): DocumentFormat | undefined => {
  const ext = extensionOf(filename)
  return DOCUMENT_FORMATS.find((item) => item.extensions.includes(ext))
}

const KIND_BADGE: Record<string, string> = {
  txt: 'TXT',
  md: 'MD',
  json: 'JSON',
  pdf: 'PDF',
  docx: 'DOCX',
  doc: 'DOC',
}

/** 文档行展示用的短标签：优先真实解析格式，其次扩展名 */
export const documentBadge = (doc: { name: string; kind?: string | null }): string => {
  if (doc.kind && KIND_BADGE[doc.kind]) return KIND_BADGE[doc.kind]
  const format = findDocumentFormat(doc.name)
  return format?.badge ?? 'FILE'
}

export const documentBadgeClass = (doc: { name: string; kind?: string | null }): string => {
  const key = doc.kind ?? findDocumentFormat(doc.name)?.key
  return (
    DOCUMENT_FORMATS.find((item) => item.key === key)?.badgeClass ?? 'bg-slate-100 text-slate-600'
  )
}

export interface FileCheckResult {
  ok: boolean
  format?: DocumentFormat
  /** 可以继续上传，但需要提醒用户（如扩展名与实际内容不一致） */
  warning?: string
  /** 无法上传的原因 */
  message?: string
}

const startsWith = (head: Uint8Array, bytes: number[]): boolean =>
  bytes.every((byte, index) => head[index] === byte)

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

const readHead = async (file: File, size = 8192): Promise<Uint8Array> =>
  new Uint8Array(await file.slice(0, Math.min(size, file.size)).arrayBuffer())

/** 上传前的格式校验：体积 → 扩展名 → 文件头 */
export const checkFile = async (file: File): Promise<FileCheckResult> => {
  const format = findDocumentFormat(file.name)
  if (!format) {
    const ext = extensionOf(file.name) || '无扩展名'
    return { ok: false, message: `不支持的文件格式：${ext}（支持 ${DOC_LIST_HINT}）` }
  }
  if (file.size === 0) {
    return { ok: false, format, message: '文件是空的，请重新导出后再上传' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      format,
      message: `文件超过 10MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩或拆分后再上传`,
    }
  }

  const head = await readHead(file)

  if (format.key === 'pdf') {
    if (!startsWith(head, PDF_MAGIC)) {
      return { ok: false, format, message: '文件内容不是有效 PDF，可能已损坏或扩展名被改过' }
    }
    return { ok: true, format }
  }

  if (format.key === 'docx') {
    if (startsWith(head, ZIP_MAGIC)) return { ok: true, format }
    if (startsWith(head, OLE_MAGIC)) {
      return {
        ok: true,
        format,
        warning: '这个文件实际是旧版 .doc，服务端会按实际格式解析',
      }
    }
    return { ok: false, format, message: '文件内容不是有效的 docx，可能已损坏' }
  }

  if (format.key === 'doc') {
    if (startsWith(head, OLE_MAGIC)) return { ok: true, format }
    if (startsWith(head, ZIP_MAGIC)) {
      return {
        ok: true,
        format,
        warning: '这个文件实际是 docx，服务端会按实际格式解析',
      }
    }
    return { ok: false, format, message: '文件内容不是有效的 doc，可能已损坏' }
  }

  // 文本类：出现 NUL 字节说明是二进制，直接拦下
  if (head.includes(0)) {
    return { ok: false, format, message: '文件包含二进制内容，不是可解析的文本' }
  }

  return { ok: true, format }
}
