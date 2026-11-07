/**
 * 文档文本抽取单测
 *
 * 覆盖：扩展名白名单、文本类归一化（BOM / CRLF）、不支持格式与空内容的错误路径。
 * doc / docx / pdf 的真实解析依赖二进制 fixture，改由 HTTP 冒烟验证。
 */

import { describe, expect, it } from 'vitest'

import { extractTextFromBuffer, isSupportedExtension, SUPPORTED_EXTENSIONS } from '../fileText.js'

describe('isSupportedExtension', () => {
  it('支持 txt / md / json / pdf / doc / docx', () => {
    for (const name of ['a.txt', 'a.md', 'a.json', 'a.pdf', 'a.doc', 'a.docx']) {
      expect(isSupportedExtension(name)).toBe(true)
    }
    expect(SUPPORTED_EXTENSIONS).toContain('.docx')
  })

  it('扩展名大小写不敏感', () => {
    expect(isSupportedExtension('需求文档.DOCX')).toBe(true)
    expect(isSupportedExtension('合同.Doc')).toBe(true)
  })

  it('拒绝未支持格式', () => {
    expect(isSupportedExtension('a.pptx')).toBe(false)
    expect(isSupportedExtension('a.exe')).toBe(false)
    expect(isSupportedExtension('noext')).toBe(false)
  })
})

describe('extractTextFromBuffer', () => {
  it('Markdown：去 BOM、CRLF 归一化为 LF', async () => {
    const raw = Buffer.from('\uFEFF# 标题\r\n\r\n正文段落\r\n', 'utf-8')
    const text = await extractTextFromBuffer(raw, 'note.md')
    expect(text).toBe('# 标题\n\n正文段落')
  })

  it('JSON：原样输出并去首尾空白', async () => {
    const raw = Buffer.from('  {"a":1}  \n', 'utf-8')
    await expect(extractTextFromBuffer(raw, 'data.json')).resolves.toBe('{"a":1}')
  })

  it('不支持的扩展名直接报错', async () => {
    await expect(extractTextFromBuffer(Buffer.from('x'), 'a.pptx')).rejects.toThrow(
      '不支持的文件类型',
    )
  })

  it('空内容报错，避免被静默标记为 ready', async () => {
    await expect(extractTextFromBuffer(Buffer.from('   \n\n'), 'empty.md')).rejects.toThrow(
      '没有提取到文本内容',
    )
  })

  it('损坏的 docx 两个解析器都失败时报错', async () => {
    await expect(extractTextFromBuffer(Buffer.from('not a zip'), 'broken.docx')).rejects.toThrow()
  })
})
