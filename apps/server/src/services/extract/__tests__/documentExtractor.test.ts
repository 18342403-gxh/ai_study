import { describe, it, expect } from 'vitest'
import {
  buildBatchText,
  dedupeCandidates,
  extractDocumentChunks,
  groupChunks,
  type DocumentChunkInput,
} from '../documentExtractor.js'
import type { ExtractedEntry, ExtractOutcome, ExtractOptions } from '../extractor.js'

const NOW = new Date(2026, 10, 7, 10, 0, 0).getTime()
const TZ = 'Asia/Shanghai'

const chunks = (count: number): DocumentChunkInput[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `chunk-${i}`,
    chunkIndex: i,
    content: `第 ${i + 1} 块内容`,
  }))

const entry = (title: string): ExtractedEntry => ({
  type: 'fact',
  title,
  content: `${title} 的内容`,
  time: null,
  recurrence: null,
  recurrenceText: null,
  confidence: 0.9,
  needsReview: false,
  duplicateHint: null,
  warnings: [],
})

const outcome = (entries: ExtractedEntry[], ok = true): ExtractOutcome => ({
  ok,
  intent: 'record',
  reply: '',
  entries,
  truncated: false,
  remaining: 0,
  failed: ok ? null : 'non_json',
  rawText: '',
})

describe('groupChunks', () => {
  it('按 5 块一组切分', () => {
    expect(groupChunks(chunks(12)).map((g) => g.length)).toEqual([5, 5, 2])
  })

  it('空数组返回空分组', () => {
    expect(groupChunks([])).toEqual([])
  })
})

describe('buildBatchText', () => {
  it('块之间用分隔线标记', () => {
    const text = buildBatchText(chunks(2))
    expect(text).toContain('【第 1 块】')
    expect(text).toContain('【第 2 块】')
    expect(text).toContain('---')
  })
})

describe('dedupeCandidates', () => {
  it('类型 + 标题 + 内容相同只保留一条', () => {
    const result = dedupeCandidates([entry('杭州'), entry('杭州'), entry('上海')])
    expect(result.map((e) => e.title)).toEqual(['杭州', '上海'])
  })

  it('标题相同但内容不同会保留', () => {
    const a = entry('杭州')
    const b = { ...entry('杭州'), content: '不同的内容' }
    expect(dedupeCandidates([a, b])).toHaveLength(2)
  })
})

describe('extractDocumentChunks', () => {
  it('12 块分 3 批调用并聚合候选', async () => {
    const calls: ExtractOptions[] = []
    const extract = async (options: ExtractOptions) => {
      calls.push(options)
      return outcome([entry(`事实 ${calls.length}`)])
    }

    const result = await extractDocumentChunks({
      chunks: chunks(12),
      nowMs: NOW,
      timezone: TZ,
      extract,
    })

    expect(calls).toHaveLength(3)
    expect(calls[0].mode).toBe('document')
    expect(calls.map((c) => c.text.split('【第').length - 1)).toEqual([5, 5, 2])
    expect(result.entries).toHaveLength(3)
    expect(result.chunksProcessed).toBe(12)
    expect(result.failedChunks).toBe(0)
    expect(result.succeededChunkIds).toHaveLength(12)
  })

  it('跨批重复候选会去重', async () => {
    const extract = async () => outcome([entry('A'), entry('B'), entry('C'), entry('D')])

    const result = await extractDocumentChunks({
      chunks: chunks(15),
      nowMs: NOW,
      timezone: TZ,
      extract,
    })

    expect(result.entries).toHaveLength(4) // 三个批次内容完全一致，跨批去重
    expect(result.truncated).toBe(false)
  })

  it('跨批组合后超过 10 条时截断', async () => {
    let call = 0
    const extract = async () => {
      call++
      return outcome(Array.from({ length: 4 }, (_, i) => entry(`第${call}批-${i}`)))
    }

    const result = await extractDocumentChunks({
      chunks: chunks(15),
      nowMs: NOW,
      timezone: TZ,
      extract,
    })

    expect(result.entries).toHaveLength(10)
    expect(result.truncated).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('批次失败时跳过并统计失败块数', async () => {
    let call = 0
    const extract = async () => {
      call++
      return call === 2 ? outcome([], false) : outcome([entry(`事实 ${call}`)])
    }

    const result = await extractDocumentChunks({
      chunks: chunks(12),
      nowMs: NOW,
      timezone: TZ,
      extract,
    })

    expect(result.failedChunks).toBe(5)
    expect(result.chunksProcessed).toBe(7)
    expect(result.succeededChunkIds).toEqual([
      'chunk-0',
      'chunk-1',
      'chunk-2',
      'chunk-3',
      'chunk-4',
      'chunk-10',
      'chunk-11',
    ])
    expect(result.entries.map((e) => e.title)).toEqual(['事实 1', '事实 3'])
  })
})
