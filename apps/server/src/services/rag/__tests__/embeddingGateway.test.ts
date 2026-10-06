/**
 * embeddingGateway 单元测试
 *
 * 策略：
 *   - hashVector()：纯函数，不需要 mock，直接测数学性质
 *   - cosineSimilarity()：纯函数，测边界条件
 *   - isMockMode()：测 mock 模式检测
 *   - getEmbedding() / getEmbeddings()：mock fetch，验证降级逻辑
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hashVector, cosineSimilarity, isMockMode } from '../embeddingGateway.js'

describe('hashVector', () => {
  it('相同文本产生相同向量（幂等）', () => {
    const a = hashVector('hello world')
    const b = hashVector('hello world')
    expect(a).toEqual(b)
  })

  it('不同文本产生不同向量', () => {
    const a = hashVector('hello')
    const b = hashVector('world')
    expect(a).not.toEqual(b)
  })

  it('向量维度正确（默认 1536）', () => {
    expect(hashVector('test').length).toBe(1536)
    expect(hashVector('test', 512).length).toBe(512)
  })

  it('向量 L2 归一化（长度 ≈ 1.0）', () => {
    const vec = hashVector('test vector normalization')
    let norm = 0
    for (const v of vec) norm += v * v
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5)
  })
})

describe('cosineSimilarity', () => {
  it('相同向量 → 1.0', () => {
    const a = [1, 2, 3]
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5)
  })

  it('正交向量 → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5)
  })

  it('相反向量 → -1.0', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5)
  })

  it('长度不同 → 0（防御性）', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('零向量分母为 0 → 0', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0)
  })
})

describe('isMockMode', () => {
  const originalForce = process.env.ENABLE_MOCK_EMBEDDING

  afterEach(() => {
    if (originalForce === undefined) {
      delete process.env.ENABLE_MOCK_EMBEDDING
    } else {
      process.env.ENABLE_MOCK_EMBEDDING = originalForce
    }
  })

  it('默认非 mock', () => {
    delete process.env.ENABLE_MOCK_EMBEDDING
    expect(isMockMode()).toBe(false)
  })

  it('ENABLE_MOCK_EMBEDDING=1 → mock', () => {
    process.env.ENABLE_MOCK_EMBEDDING = '1'
    expect(isMockMode()).toBe(true)
  })
})
