/**
 * 文档解析公共类型
 *
 * 每种格式一个解析器，解析器只负责「把二进制变成纯文本」，
 * 文件类型识别、归一化、空内容校验统一由 index.ts 处理。
 */

export type DocumentKind = 'txt' | 'md' | 'json' | 'pdf' | 'docx' | 'doc'

export interface ParseOutput {
  text: string
  /** 解析过程中的非致命提示（如编码回退、扩展名与实际格式不一致） */
  warnings: string[]
}

export interface ParsedDocument extends ParseOutput {
  /** 最终选择的解析器 */
  kind: DocumentKind
  /** 上传文件声明的扩展名，如 .docx */
  extension: string
  /** 归一化后的正文字符数 */
  chars: number
}

export interface DetectionResult {
  kind: DocumentKind
  extension: string
  warnings: string[]
}

/** 解析器统一签名 */
export type DocumentParser = (buffer: Buffer) => Promise<ParseOutput>
