/**
 * 第三方办公文档解析库的类型声明（两者都不随包提供 .d.ts）
 */

declare module 'mammoth' {
  export interface RawTextResult {
    value: string
    messages: Array<{ type: string; message: string }>
  }

  /** 抽取纯文本（保留段落换行，表格按制表符/换行展开） */
  export function extractRawText(input: { buffer: Buffer }): Promise<RawTextResult>
}

declare module 'word-extractor' {
  interface ExtractedDocument {
    getBody(): string
    getFootnotes(): string
    getHeaders(): string
    getFooters(): string
  }

  class WordExtractor {
    /** 支持 .doc（OLE2）与 .docx；传 Buffer 或文件路径 */
    extract(source: Buffer | string): Promise<ExtractedDocument>
  }

  export default WordExtractor
}
