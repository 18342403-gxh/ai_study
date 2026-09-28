/**
 * RRF（Reciprocal Rank Fusion）单元测试
 *
 * score(d) = Σ 1/(k + rank(d))  — k=60（标准值）
 * rank 从 1 开始（Top-1 分数最高）
 */
import { describe, it, expect } from 'vitest'
import { rrfFuse } from '../index.js'
import type { VectorSearchResult } from '../vectorStore.js'
import type { BM25Result } from '../bm25.js'

function makeVectorResult(id: string, rank: number): VectorSearchResult {
  return {
    doc: { id, content: `content-${id}`, metadata: {} },
    score: 1 - rank * 0.1, // 虚拟 cosine score，不影响 RRF 融合
  }
}

function makeBM25Result(id: string, rank: number): BM25Result {
  return {
    id,
    doc_id: 'doc-1',
    content: `content-${id}`,
    chunk_index: rank - 1,
    score: 100 - rank * 10, // 虚拟 BM25 score
  }
}

describe('RRF Fusion', () => {
  it('k=60 标准值 — Top-1 的分数 = 1/61 ≈ 0.0164', () => {
    // 只有 vector 结果，看 Top-1 分数
    const vector: VectorSearchResult[] = [makeVectorResult('a', 1)]
    const bm25: BM25Result[] = []

    const result = rrfFuse(vector, bm25, 60)
    expect(result).toHaveLength(1)
    expect(result[0].score).toBeCloseTo(1 / 61, 5)
  })

  it('同一个 doc 在两路都排名靠前 → RRF 分数叠加', () => {
    const vector: VectorSearchResult[] = [
      makeVectorResult('a', 1), // Top-1
      makeVectorResult('b', 2),
    ]
    const bm25: BM25Result[] = [
      makeBM25Result('a', 1), // Top-1
      makeBM25Result('c', 2),
    ]

    const result = rrfFuse(vector, bm25, 60)

    // doc-a 两路都有 → 分数 = 1/61 + 1/61 = 0.0328
    const a = result.find((r) => r.id === 'a')!
    expect(a.score).toBeCloseTo(1 / 61 + 1 / 61, 5)

    // doc-a 应该排第一（在两路都 Top-1）
    expect(result[0].id).toBe('a')
  })

  it('纯 vector — 等同于只看 vector 排名', () => {
    const vector: VectorSearchResult[] = [
      makeVectorResult('top1', 1),
      makeVectorResult('top2', 2),
      makeVectorResult('top3', 3),
    ]
    const result = rrfFuse(vector, [], 60)

    expect(result[0].id).toBe('top1')
    expect(result[1].id).toBe('top2')
    expect(result[2].id).toBe('top3')
  })

  it('纯 bm25 — 等同于只看 bm25 排名', () => {
    const bm25: BM25Result[] = [makeBM25Result('bm-top1', 1), makeBM25Result('bm-top2', 2)]
    const result = rrfFuse([], bm25, 60)

    expect(result[0].id).toBe('bm-top1')
    expect(result[1].id).toBe('bm-top2')
  })

  it('vector 独有的 doc 只加 vector 的分', () => {
    const vector: VectorSearchResult[] = [
      makeVectorResult('shared', 1), // Top-1
      makeVectorResult('vector-only', 2),
    ]
    const bm25: BM25Result[] = [
      makeBM25Result('bm-only', 1), // bm-only Top-1（注意 shared 在 bm25 里 rank2）
      makeBM25Result('shared', 2),
    ]

    const result = rrfFuse(vector, bm25, 60)

    // shared: vector rank1 + bm25 rank2 → 1/61 + 1/62
    const shared = result.find((r) => r.id === 'shared')!
    expect(shared.score).toBeGreaterThan(1 / 61)

    // bm-only: bm25 rank1 → 1/61
    const bmOnly = result.find((r) => r.id === 'bm-only')!
    expect(bmOnly.score).toBeCloseTo(1 / 61, 5)

    // vector-only: vector rank2 → 1/62，且 < bm-only (1/61)
    const vOnly = result.find((r) => r.id === 'vector-only')!
    expect(vOnly.score).toBeCloseTo(1 / 62, 5)
  })

  it('分数总和不超过两路 Top-K 的最大可能值', () => {
    // 极端情况：100 个 doc 两路都有，k=60
    const vector = Array.from({ length: 100 }, (_, i) => makeVectorResult(`v${i}`, i + 1))
    const bm25 = Array.from({ length: 100 }, (_, i) => makeBM25Result(`b${i}`, i + 1))

    const result = rrfFuse(vector, bm25, 60)

    // 每个 doc 最多出现 2 次（vector + bm25 各 1）
    // 每个 doc 分数 < 1/61 + 1/61 ≈ 0.0328
    for (const r of result) {
      expect(r.score).toBeLessThan(0.04)
    }

    // Top-1 至少一路有分（可能只有一路提供 rank1 → score = 1/61）
    expect(result[0].score).toBeGreaterThanOrEqual(1 / 61)
  })
})
