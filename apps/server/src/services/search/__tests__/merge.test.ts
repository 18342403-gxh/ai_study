/**
 * 合并与排序单测 — spec 4.5.3 / 4.5.4
 *
 * 覆盖：通道权重、时间/语义重复条目去重、相邻块合并、数量上限与汇总行。
 */

import { describe, it, expect } from 'vitest'

import {
  DOC_WEIGHT,
  ENTRY_WEIGHT,
  MAX_DOC_RESULTS,
  MAX_ENTRY_RESULTS,
  TIME_WEIGHT,
  mergeSearchSignals,
  type MergeInput,
  type SearchResultItem,
} from '../merge.js'

type EntryRow = MergeInput['timeHits'][number]['entry']
type TimeHit = MergeInput['timeHits'][number]
type EntryHit = MergeInput['entryHits'][number]
type DocHit = MergeInput['docHits'][number]

const BASE = new Date(2026, 10, 6, 10, 0).getTime()

const makeEntry = (id: string, over: Partial<EntryRow> = {}): EntryRow =>
  ({
    id,
    userId: 'local',
    libraryId: 'default',
    type: 'schedule',
    title: `条目 ${id}`,
    content: `内容 ${id}`,
    status: 'active',
    startAt: new Date(BASE),
    endAt: null,
    recurrence: null,
    recurrenceUntil: null,
    exceptions: null,
    sourceType: 'manual',
    sourceRef: null,
    confidence: 1,
    createdAt: new Date(BASE),
    updatedAt: new Date(BASE),
    archivedAt: null,
    ...over,
  }) as EntryRow

const timeHit = (id: string, over: Partial<EntryRow> = {}, startAt = BASE, score = 1): TimeHit => ({
  entry: makeEntry(id, { type: 'schedule', ...over }),
  startAt,
  endAt: null,
  occurrence: false,
  score,
})

const entryHit = (id: string, score = 0.03, type: EntryRow['type'] = 'fact'): EntryHit => ({
  entry: makeEntry(id, { type, startAt: null }),
  score,
})

const docHit = (docId: string, chunkIndex: number, score = 0.02): DocHit => ({
  docId,
  chunkId: `${docId}-${chunkIndex}`,
  chunkIndex,
  content: `块 ${chunkIndex}`,
  score,
})

const find = (results: SearchResultItem[], key: string) => results.find((r) => r.key === key)

describe('mergeSearchSignals', () => {
  it('通道权重：时间 1.3 > 语义条目 1.0 > 文档块 0.8', () => {
    const { results } = mergeSearchSignals({
      timeHits: [timeHit('t1')],
      entryHits: [entryHit('e1')],
      docHits: [docHit('d1', 0)],
    })

    const time = results.find((r) => r.source === 'time')!
    const entry = results.find((r) => r.kind === 'entry' && r.source === 'semantic')!
    const doc = results.find((r) => r.kind === 'chunk')!

    // 三条各自是通道内唯一命中 → 归一化分都是 1
    expect(time.score).toBeCloseTo(TIME_WEIGHT)
    expect(entry.score).toBeCloseTo(ENTRY_WEIGHT)
    expect(doc.score).toBeCloseTo(DOC_WEIGHT)
    expect(results.map((r) => r.source)).toEqual(['time', 'semantic', 'semantic'])
  })

  it('同一条目在时间与语义通道都命中时只保留一次（保留时间实例）', () => {
    const start = BASE + 60_000
    const { results } = mergeSearchSignals({
      timeHits: [timeHit('same', {}, start, 0.9)],
      entryHits: [entryHit('same')],
      docHits: [],
    })

    const hits = results.filter((r) => r.entryId === 'same')
    expect(hits).toHaveLength(1)
    // 单次事件 key 只按条目定位；重复实例才带开始时间
    expect(hits[0].key).toBe('entry:same')
    expect(hits[0].startAt).toBe(start)
  })

  it('重复事件的不同实例各占一条（key 带实例开始时间）', () => {
    const first = BASE
    const second = BASE + 7 * 86_400_000
    const row = makeEntry('weekly', { type: 'schedule' })
    const { results } = mergeSearchSignals({
      timeHits: [
        { entry: row, startAt: first, endAt: null, occurrence: true, score: 1 },
        { entry: row, startAt: second, endAt: null, occurrence: true, score: 0.9 },
      ],
      entryHits: [],
      docHits: [],
    })

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.occurrence)).toEqual([true, true])
  })

  it('同一文档相邻块合并为一条引用，内容拼接', () => {
    const { results } = mergeSearchSignals({
      timeHits: [],
      entryHits: [],
      docHits: [docHit('doc1', 0, 0.03), docHit('doc1', 1, 0.02), docHit('doc1', 3, 0.01)],
    })

    const chunks = results.filter((r) => r.kind === 'chunk')
    expect(chunks).toHaveLength(2)
    expect(chunks[0].content).toContain('块 0')
    expect(chunks[0].content).toContain('块 1')
    expect(chunks[1].content).toBe('块 3')
  })

  it('条目最多 10 条，超出部分汇总', () => {
    const timeHits = Array.from({ length: 12 }, (_, i) =>
      timeHit(`t${i}`, { type: 'schedule' }, BASE + i * 3_600_000, 1 - i * 0.01),
    )
    const { results, summary } = mergeSearchSignals({ timeHits, entryHits: [], docHits: [] })

    expect(results).toHaveLength(MAX_ENTRY_RESULTS)
    expect(summary).not.toBeNull()
    expect(summary!.remaining).toBe(2)
    expect(summary!.byType.schedule).toBe(2)
    expect(summary!.text).toContain('另有 2 条相关记录')
    expect(summary!.text).toContain('2 条日程')
  })

  it('文档块最多 5 条，超出部分计入汇总', () => {
    const docHits = Array.from({ length: 8 }, (_, i) => docHit(`doc${i}`, 0, 1 - i * 0.01))
    const { results, summary } = mergeSearchSignals({ timeHits: [], entryHits: [], docHits })

    expect(results.filter((r) => r.kind === 'chunk')).toHaveLength(MAX_DOC_RESULTS)
    expect(summary!.docChunks).toBe(3)
    expect(summary!.text).toContain('3 条文档片段')
  })

  it('没有超出上限时不产生汇总行', () => {
    const { results, summary } = mergeSearchSignals({
      timeHits: [timeHit('t1')],
      entryHits: [entryHit('e1')],
      docHits: [docHit('d1', 0)],
    })

    expect(results).toHaveLength(3)
    expect(summary).toBeNull()
    expect(find(results, 'entry:t1')).toBeDefined()
  })
})
