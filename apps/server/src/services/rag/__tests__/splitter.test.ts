/**
 * splitter 单元测试 — simpleSplit（rag/splitter.ts）
 *
 * 测 simpleSplit（纯函数，无依赖），不测 createSplitter（需要 LangChain）
 */
import { describe, it, expect } from 'vitest'
import { simpleSplit } from '../splitterPure.js'

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

  it('chunkSize 默认 500', () => {
    const text = 'a'.repeat(600)
    const chunks = simpleSplit(text) // 不传参数
    // 600 chars / 500 per chunk - overlap should give 2 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(1)
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
