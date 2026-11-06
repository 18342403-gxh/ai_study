/**
 * splitter 单元测试 — simpleSplit / splitStructured（rag/splitterPure.ts）
 *
 * 只测纯函数（无依赖），不测 createSplitter（需要 LangChain）
 */
import { describe, it, expect } from 'vitest'
import { simpleSplit, splitStructured } from '../splitterPure.js'

describe('simpleSplit', () => {
  it('短文本（<= maxChunkSize）→ 单块', () => {
    const chunks = simpleSplit('hello world', 500, 50)
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toBe('hello world')
    expect(chunks[0].index).toBe(0)
    expect(chunks[0].id).toBeTruthy()
  })

  it('长文本 → 多块', () => {
    const text = 'a'.repeat(1000)
    const chunks = simpleSplit(text, 400, 50)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].content.length).toBeLessThanOrEqual(400)
  })

  it('每块 index 递增', () => {
    const text = 'a'.repeat(1500)
    const chunks = simpleSplit(text, 300, 50)
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i)
    }
  })

  it('chunkSize 默认 600（v5 收敛）', () => {
    const text = 'a'.repeat(600)
    const chunks = simpleSplit(text) // 不传参数
    expect(chunks.length).toBe(1)
    const longer = 'a'.repeat(1200)
    expect(simpleSplit(longer).length).toBeGreaterThan(1)
  })

  it('空文本 → 单块空内容', () => {
    const chunks = simpleSplit('', 500, 50)
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toBe('')
  })

  it('返回类型包含所有必需字段', () => {
    const chunks = simpleSplit('test content', 500, 50)
    const c = chunks[0]
    expect(c).toHaveProperty('id')
    expect(c).toHaveProperty('content')
    expect(c).toHaveProperty('index')
    expect(c).toHaveProperty('metadata')
    expect(c.metadata).toHaveProperty('tokenCount')
  })
})

describe('splitStructured', () => {
  it('短文本 → 单块，带完整元数据', () => {
    const chunks = splitStructured('一段不长的话。')
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toBe('一段不长的话。')
    expect(chunks[0].metadata).toMatchObject({
      contentType: 'text',
      headingPath: [],
      charStart: 0,
    })
  })

  it('Markdown 标题 → 结构块，带 headingPath', () => {
    const body = '这是一段足够长的正文内容，用来避免小块合并逻辑把标题块并掉。'.repeat(3)
    const md = ['# 项目笔记', '## 前端工程化', '### 构建', body, '### 测试', body].join('\n')
    const chunks = splitStructured(md)
    expect(chunks.length).toBe(2)
    expect(chunks[0].metadata.headingPath).toEqual(['项目笔记', '前端工程化', '构建'])
    expect(chunks[1].metadata.headingPath).toEqual(['项目笔记', '前端工程化', '测试'])
    expect(chunks[0].content).toContain('### 构建')
  })

  it('超长段落（>600 无空行）→ 按句子切', () => {
    const sentence = '这是一个用来凑长度的句子，里面什么实质内容都没有。'
    const text = sentence.repeat(40) // ~1000 字符，无空行
    const chunks = splitStructured(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(600)
    }
    // 句子不应被切断（每块以句号结尾）
    expect(chunks[0].content.endsWith('。')).toBe(true)
  })

  it('无标点超长文本 → 600 硬切 + 80 重叠', () => {
    const text = 'a'.repeat(1500)
    const chunks = splitStructured(text)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0].content.length).toBe(600)
    // 重叠校验：第 2 块开头 == 第 1 块结尾 80 字符
    expect(chunks[1].content.slice(0, 80)).toBe(chunks[0].content.slice(-80))
  })

  it('代码块整体保留不被切断', () => {
    const code = '```ts\n' + 'const x = 1\n'.repeat(30) + '```'
    const text = `前置说明文字，要足够长避免被小块合并。\n\n${code}\n\n后续说明文字，同样要足够长避免被小块合并掉。`
    const chunks = splitStructured(text)
    const codeChunks = chunks.filter((c) => c.metadata.contentType === 'code')
    expect(codeChunks.length).toBe(1)
    expect(codeChunks[0].content).toContain('```ts')
    expect(codeChunks[0].content.endsWith('```')).toBe(true)
  })

  it('段落打包：多个短段落合并到接近 600', () => {
    const para = '这是一段约五十字的普通段落内容，用来验证段落合并逻辑是否按预期工作。'
    const text = Array.from({ length: 20 }, () => para).join('\n\n') // ~1000 字符
    const chunks = splitStructured(text)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0].content.length).toBeLessThanOrEqual(600)
    expect(chunks[0].content.length).toBeGreaterThan(400)
  })

  it('小块（<80）并入前一块', () => {
    const long = '长段落。'.repeat(100) // 400 字符 text 块
    const text = `${long}\n\n短尾巴。`
    const chunks = splitStructured(text)
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toContain('短尾巴。')
  })

  it('块数超过上限 → 抛错提示', () => {
    const text = '一句话。\n\n'.repeat(300) // 小 target 下产生大量块
    expect(() => splitStructured(text, { targetSize: 10, minChunkSize: 0, maxChunks: 50 })).toThrow(
      /文档过大/,
    )
  })
})
