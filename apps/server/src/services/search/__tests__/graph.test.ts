/**
 * 检索图条件边单测 — Task 2 / AC-3 / AC-7
 *
 * 覆盖三种分支：通用问题早退、单候选跳过 rerank、多候选进入 rerank。
 * 节点内部的通道调用由既有通道单测覆盖，这里只测纯函数路由。
 */

import { afterEach, describe, it, expect } from 'vitest'

import { routeAfterMerge, routeAfterRetrieve, shouldExitEarly, shouldRerank } from '../graph.js'
import type { SearchResultItem } from '../merge.js'

const candidates = (count: number): SearchResultItem[] =>
  Array.from({ length: count }, (_, i) => ({ key: `c${i}` })) as unknown as SearchResultItem[]

describe('routeAfterRetrieve', () => {
  it('通用问题且条目/文档全空 → finalize 早退', () => {
    expect(routeAfterRetrieve({ needsPersonal: false, docHits: [], entryHits: [] })).toBe(
      'finalize',
    )
  })

  it('通用问题但文档命中 → 走 merge', () => {
    expect(
      shouldExitEarly({
        needsPersonal: false,
        docHits: [{}] as never[],
        entryHits: [],
      }),
    ).toBe(false)
    expect(
      routeAfterRetrieve({
        needsPersonal: false,
        docHits: [{}] as never[],
        entryHits: [],
      }),
    ).toBe('merge')
  })

  it('个人问题即使三通道全空也走 merge（交给兜底逻辑）', () => {
    expect(routeAfterRetrieve({ needsPersonal: true, docHits: [], entryHits: [] })).toBe('merge')
  })
})

describe('routeAfterMerge', () => {
  afterEach(() => {
    delete process.env.ENABLE_RERANK
  })

  it('单候选跳过 rerank → finalize', () => {
    expect(shouldRerank(1, true)).toBe(false)
    expect(routeAfterMerge({ candidateResults: candidates(1) })).toBe('finalize')
  })

  it('多候选且开关开启 → rerank', () => {
    process.env.ENABLE_RERANK = '1'
    expect(shouldRerank(2, true)).toBe(true)
    expect(routeAfterMerge({ candidateResults: candidates(2) })).toBe('rerank')
  })

  it('多候选但开关关闭 → finalize', () => {
    expect(shouldRerank(2, false)).toBe(false)
    expect(routeAfterMerge({ candidateResults: candidates(2) })).toBe('finalize')
  })

  it('默认按 ENABLE_RERANK 环境变量判断', () => {
    expect(routeAfterMerge({ candidateResults: candidates(2) })).toBe('finalize')

    process.env.ENABLE_RERANK = '1'
    expect(routeAfterMerge({ candidateResults: candidates(2) })).toBe('rerank')
  })
})
