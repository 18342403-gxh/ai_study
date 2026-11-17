/**
 * 文档解析单测
 *
 * 重点覆盖「扩展名与真实内容不一致」和「编码识别」这两类真实故障：
 * 只看扩展名的旧实现会在这里失败。
 */

import { describe, expect, it } from 'vitest'

import { detectDocumentKind } from '../detect.js'
import { decodePlainText } from '../parsers/text.js'
import { extractDocument, extractTextFromBuffer } from '../index.js'

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

const zipWith = (entry: string): Buffer =>
  Buffer.concat([ZIP_MAGIC, Buffer.from(entry, 'latin1'), Buffer.alloc(32)])

const oleWith = (entry: string): Buffer =>
  Buffer.concat([OLE_MAGIC, Buffer.from(entry, 'utf16le'), Buffer.alloc(32)])

describe('detectDocumentKind', () => {
  it('PDF 内容被改名成 .txt 时按 PDF 解析并给出提示', () => {
    const result = detectDocumentKind(Buffer.from('%PDF-1.7\n...'), '伪装.txt')
    expect(result.kind).toBe('pdf')
    expect(result.warnings[0]).toContain('已按实际格式解析')
  })

  it('识别 zip 容器中的 docx', () => {
    expect(detectDocumentKind(zipWith('word/document.xml'), 'a.docx').kind).toBe('docx')
  })

  it('旧版 .doc 被改名成 .docx 时按 doc 解析', () => {
    const result = detectDocumentKind(oleWith('WordDocument'), '旧文档.docx')
    expect(result.kind).toBe('doc')
    expect(result.warnings[0]).toContain('实际内容为 Word（doc）')
  })

  it('xlsx / pptx 给出明确的不支持提示', () => {
    expect(() => detectDocumentKind(zipWith('xl/workbook.xml'), '表格.xlsx')).toThrow('Excel')
    expect(() => detectDocumentKind(zipWith('ppt/presentation.xml'), '演示.pptx')).toThrow(
      'PowerPoint',
    )
  })

  it('扩展名是 PDF 但内容不是 PDF 时直接报错', () => {
    expect(() => detectDocumentKind(Buffer.from('普通文本'), '假的.pdf')).toThrow('不是有效的 PDF')
  })

  it('二进制内容伪装成文本时被拦下', () => {
    expect(() => detectDocumentKind(Buffer.from([0x41, 0x00, 0x42]), 'a.txt')).toThrow('二进制数据')
  })

  it('空文件与未知扩展名报错', () => {
    expect(() => detectDocumentKind(Buffer.alloc(0), 'a.txt')).toThrow('文件内容为空')
    expect(() => detectDocumentKind(Buffer.from('x'), 'a.exe')).toThrow('不支持的文件类型')
  })
})

describe('文本编码识别', () => {
  it('UTF-8 正常解码，无提示', () => {
    const decoded = decodePlainText(Buffer.from('中文内容', 'utf-8'))
    expect(decoded.text).toBe('中文内容')
    expect(decoded.warnings).toEqual([])
  })

  it('GB18030（记事本默认 GBK）回退解码并提示', () => {
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]) // “中文”的 GBK 编码
    const decoded = decodePlainText(gbk)
    expect(decoded.text).toBe('中文')
    expect(decoded.warnings[0]).toContain('GB18030')
  })

  it('UTF-16LE BOM 正常解码', () => {
    const raw = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好', 'utf16le')])
    expect(decodePlainText(raw).text).toBe('你好')
  })
})

describe('extractDocument', () => {
  it('GBK 编码的 txt 能端到端提取', async () => {
    const raw = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]) // 中文
    const parsed = await extractDocument(raw, '记录.txt')
    expect(parsed.text).toBe('中文')
    expect(parsed.kind).toBe('txt')
    expect(parsed.warnings[0]).toContain('GB18030')
  })

  it('Markdown 去 BOM、CRLF 归一化', async () => {
    const raw = Buffer.from('\uFEFF# 标题\r\n\r\n正文\r\n', 'utf-8')
    await expect(extractTextFromBuffer(raw, 'note.md')).resolves.toBe('# 标题\n\n正文')
  })

  it('损坏的 docx 给出可读错误', async () => {
    await expect(extractDocument(Buffer.from('not a zip'), 'broken.docx')).rejects.toThrow(
      '不是有效的 Word 文档',
    )
  })

  it('空文本不会静默通过', async () => {
    await expect(extractDocument(Buffer.from('   \n\n'), 'empty.md')).rejects.toThrow(
      '没有可提取的内容',
    )
  })
})
