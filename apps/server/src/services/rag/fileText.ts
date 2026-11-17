/**
 * 文档文本抽取 — 兼容入口
 *
 * 实现已按格式拆分到 services/documents：
 *   txt / md / json、pdf、docx、doc 各有独立解析器与错误提示。
 * 这里仅保留既有导出名，避免调用方与测试大规模改动。
 */

export {
  SUPPORTED_EXTENSIONS,
  isSupportedExtension,
  extractTextFromBuffer,
  extractTextFromFile,
  extractDocument,
  detectDocumentKind,
} from '../documents/index.js'

export type { DocumentKind, ParsedDocument } from '../documents/index.js'
