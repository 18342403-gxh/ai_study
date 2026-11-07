/**
 * 文档纯文本抽取 — 上传链路的统一入口
 *
 * 支持 txt / md / json / pdf / doc / docx：
 *   - pdf  → pdf-parse
 *   - docx → mammoth（失败时回落 word-extractor，兼容被改名的旧 .doc）
 *   - doc  → word-extractor（OLE2 二进制，纯 JS，无外部二进制依赖）
 *   - 文本 → 按 UTF-8 读取
 *
 * 输出统一归一化（去 BOM、CRLF → LF、去首尾空白），空内容直接报错，
 * 避免扫描件 / 空文档被静默标记为 ready。
 */

import path from 'path'

/** 上传允许的扩展名：multer fileFilter 与解析器共用，避免两处漂移 */
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.json', '.pdf', '.doc', '.docx']

export const isSupportedExtension = (filename: string): boolean =>
  SUPPORTED_EXTENSIONS.includes(path.extname(filename).toLowerCase())

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

const normalize = (text: string): string => stripBom(text).replace(/\r\n?/g, '\n').trim()

const extractPdf = async (buffer: Buffer): Promise<string> => {
  const pdfParse = (await import('pdf-parse')).default
  const data = await pdfParse(buffer)
  return data.text
}

const extractDocx = async (buffer: Buffer): Promise<string> => {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

const extractDoc = async (buffer: Buffer): Promise<string> => {
  const WordExtractor = (await import('word-extractor')).default
  const doc = await new WordExtractor().extract(buffer)
  return doc.getBody()
}

export const extractTextFromBuffer = async (buffer: Buffer, filename: string): Promise<string> => {
  const ext = path.extname(filename).toLowerCase()
  let text: string

  switch (ext) {
    case '.pdf':
      text = await extractPdf(buffer)
      break
    case '.docx':
      // 常见情况：旧 .doc 被改名成 .docx，mammoth 解析不了，回落到 OLE 解析器
      text = await extractDocx(buffer).catch(() => extractDoc(buffer))
      break
    case '.doc':
      text = await extractDoc(buffer)
      break
    case '.txt':
    case '.md':
    case '.json':
      text = buffer.toString('utf-8')
      break
    default:
      throw new Error(`不支持的文件类型: ${ext}`)
  }

  const normalized = normalize(text)
  if (!normalized) {
    throw new Error('文档中没有提取到文本内容（可能是扫描件或空文档）')
  }
  return normalized
}

export const extractTextFromFile = async (filePath: string, filename: string): Promise<string> => {
  const fs = await import('fs/promises')
  const buffer = await fs.readFile(filePath)
  return extractTextFromBuffer(buffer, filename)
}
