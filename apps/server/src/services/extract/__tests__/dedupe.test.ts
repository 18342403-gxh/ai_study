import { describe, it, expect, vi } from 'vitest'

// mock embedding：让「标题/时间」信号路径的判定稳定可控。
// cosineSimilarity 固定返回 0.5（不高不低），这样只有标题/时间信号能决定档位。
vi.mock('../../rag/embeddings.js', () => ({
  getEmbedding: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: vi.fn(() => 0.5),
}))

import {
  buildDedupeInfo,
  findBestDuplicate,
  findExactDuplicate,
  findTimeConflicts,
  intervalsOverlap,
  bigramSimilarity,
  type ExistingEntry,
} from '../dedupe.js'
import type { ExtractedEntry } from '../extractor.js'

/** 固定基准：2026-11-07（周六）10:00 本地时间 */
const NOW = new Date(2026, 10, 7, 10, 0, 0).getTime()
const at = (day: number, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute, 0).getTime()

const makeEntry = (overrides: Partial<ExtractedEntry> = {}): ExtractedEntry => ({
  type: 'schedule',
  title: '开会',
  content: '明天下午两点开会',
  time: {
    raw: '明天下午两点',
    start: at(8, 14),
    end: at(8, 15),
    confidence: 0.9,
    startText: '',
    endText: null,
  },
  recurrence: null,
  recurrenceText: null,
  confidence: 0.9,
  needsReview: false,
  duplicateHint: null,
  warnings: [],
  ...overrides,
})

const makeExisting = (overrides: Partial<ExistingEntry> = {}): ExistingEntry => ({
  id: 'e1',
  type: 'schedule',
  title: '开会',
  content: '明天下午两点开会',
  startAt: at(8, 14),
  endAt: at(8, 15),
  recurrence: null,
  recurrenceUntil: null,
  ...overrides,
})

describe('intervalsOverlap', () => {
  it('重叠区间返回 true', () => {
    expect(intervalsOverlap(at(8, 14), at(8, 15), at(8, 14, 30), at(8, 16))).toBe(true)
  })

  it('相邻不重叠返回 false', () => {
    expect(intervalsOverlap(at(8, 14), at(8, 15), at(8, 15), at(8, 16))).toBe(false)
  })

  it('无结束时间按 1 小时估算', () => {
    expect(intervalsOverlap(at(8, 14), null, at(8, 14, 30), null)).toBe(true)
    expect(intervalsOverlap(at(8, 14), null, at(8, 16), null)).toBe(false)
  })
})

describe('bigramSimilarity', () => {
  it('完全相同为 1', () => {
    expect(bigramSimilarity('面试', '面试')).toBe(1)
  })
  it('完全不相关为 0', () => {
    expect(bigramSimilarity('面试', '跑步')).toBe(0)
  })
  it('部分重叠在 0-1 之间', () => {
    const s = bigramSimilarity('明天下午面试', '下午面试')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })
})

describe('findExactDuplicate', () => {
  it('类型 + 标题相同且相似度 > 0.9 时判定重复', () => {
    const duplicate = findExactDuplicate(makeEntry(), [makeExisting()], () => 0.95)
    expect(duplicate).toEqual({ entryId: 'e1', title: '开会', similarity: 0.95 })
  })

  it('相似度等于 0.9 不算重复', () => {
    expect(findExactDuplicate(makeEntry(), [makeExisting()], () => 0.9)).toBeNull()
  })

  it('类型不同不算重复', () => {
    expect(findExactDuplicate(makeEntry({ type: 'plan' }), [makeExisting()], () => 0.99)).toBeNull()
  })

  it('标题不同不算重复', () => {
    expect(
      findExactDuplicate(makeEntry({ title: '评审' }), [makeExisting()], () => 0.99),
    ).toBeNull()
  })
})

describe('findTimeConflicts', () => {
  it('单次日程重叠时返回冲突', () => {
    const conflicts = findTimeConflicts(makeEntry(), [makeExisting()], NOW)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].entryId).toBe('e1')
  })

  it('时间不重叠时返回空', () => {
    const conflicts = findTimeConflicts(
      makeEntry(),
      [makeExisting({ startAt: at(9, 9), endAt: at(9, 10) })],
      NOW,
    )
    expect(conflicts).toHaveLength(0)
  })

  it('非日程类型不做冲突检测', () => {
    const conflicts = findTimeConflicts(makeEntry({ type: 'plan' }), [makeExisting()], NOW)
    expect(conflicts).toHaveLength(0)
  })

  it('重复日程按窗口展开后检测冲突', () => {
    const recurring = makeExisting({
      id: 'recurring',
      title: '周会',
      startAt: at(2, 9),
      endAt: at(2, 10),
      recurrence: {
        freq: 'WEEKLY',
        byWeekday: ['MO'],
        until: new Date(2027, 10, 1).getTime(),
      },
      recurrenceUntil: null,
    })
    const candidate = makeEntry({
      title: '临时会',
      time: {
        raw: '下周一早上九点半',
        start: at(9, 9, 30),
        end: at(9, 10, 30),
        confidence: 0.9,
        startText: '',
        endText: null,
      },
    })

    const conflicts = findTimeConflicts(candidate, [recurring], NOW)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].start).toBe(at(9, 9))
  })
})

describe('findBestDuplicate — 三档判重', () => {
  it('exact：标题 + 内容完全一致（走 identical 捷径，不调 embedding）', async () => {
    const dup = await findBestDuplicate(makeEntry(), [makeExisting()])
    expect(dup).toEqual({
      entryId: 'e1',
      title: '开会',
      similarity: 1,
      level: 'exact',
      action: 'skip',
      reason: '标题和内容完全一致',
    })
  })

  it('similar：标题相同 + 时间重叠（内容不同也合并）', async () => {
    const candidate = makeEntry({ content: '明天下午两点开会讨论新项目排期' })
    const existing = makeExisting({ content: '明天下午两点开会' })
    const dup = await findBestDuplicate(candidate, [existing])
    expect(dup?.level).toBe('similar')
    expect(dup?.action).toBe('merge')
    expect(dup?.entryId).toBe('e1')
  })

  it('similar：标题互相包含 + 时间重叠（「面试」vs「明天下午面试」）', async () => {
    const candidate = makeEntry({ title: '明天下午面试', content: '明天下午有个面试' })
    const existing = makeExisting({ title: '面试', content: '后天面试', id: 'e2' })
    const dup = await findBestDuplicate(candidate, [existing])
    expect(dup?.level).toBe('similar')
    expect(dup?.action).toBe('merge')
    expect(dup?.entryId).toBe('e2')
  })

  it('不判重：标题相同但 schedule 时间不重叠、内容相似度低', async () => {
    // 同名但不同时段的会议是不同会议，不应误判
    const candidate = makeEntry({ content: '完全不一样的另一场讨论' })
    const existing = makeExisting({ startAt: at(20, 14), endAt: at(20, 15), content: '别的内容' })
    const dup = await findBestDuplicate(candidate, [existing])
    expect(dup).toBeNull()
  })

  it('类型不同直接跳过', async () => {
    const candidate = makeEntry({ type: 'note' })
    const dup = await findBestDuplicate(candidate, [makeExisting()])
    expect(dup).toBeNull()
  })

  it('无候选时返回 null', async () => {
    const dup = await findBestDuplicate(makeEntry({ title: '健身' }), [
      makeExisting({ title: '跑步', content: '晨跑', startAt: at(1, 7), endAt: at(1, 8) }),
    ])
    expect(dup).toBeNull()
  })

  it('GoldenMatch：对话 fact 与文档 note 识别为同一实体并合并', async () => {
    const candidate = makeEntry({
      type: 'fact',
      title: '龚熙皓是一个全栈开发',
      content: '龚熙皓是一个全栈开发',
      time: null,
    })
    const existing = makeExisting({
      id: 'resume',
      type: 'note',
      title: '龚熙皓的简历',
      content: '龚熙皓是一位前端开发工程师。',
      startAt: null,
      endAt: null,
    })

    const dup = await findBestDuplicate(candidate, [existing])
    expect(dup?.entryId).toBe('resume')
    expect(dup?.action).toBe('merge')
    expect(dup?.reason).toContain('龚熙皓')
  })

  it('GoldenMatch：不同姓名只提示相关，不自动合并', async () => {
    const candidate = makeEntry({
      type: 'fact',
      title: '龚熙皓是一个全栈开发',
      content: '龚熙皓是一个全栈开发',
      time: null,
    })
    const existing = makeExisting({
      id: 'another-person',
      type: 'note',
      title: '龚熙明的简历',
      content: '龚熙明是一位前端开发工程师。',
      startAt: null,
      endAt: null,
    })

    const dup = await findBestDuplicate(candidate, [existing])
    expect(dup?.entryId).toBe('another-person')
    expect(dup?.level).toBe('related')
    expect(dup?.action).toBe('create')
  })
})

describe('buildDedupeInfo', () => {
  it('内容完全一致时判为 exact（不调用 embedding）', async () => {
    const info = await buildDedupeInfo(makeEntry(), [makeExisting()], NOW)
    expect(info.duplicate).toEqual({
      entryId: 'e1',
      title: '开会',
      similarity: 1,
      level: 'exact',
      action: 'skip',
      reason: '标题和内容完全一致',
    })
    expect(info.conflicts).toHaveLength(1)
  })

  it('相似日程同时返回 duplicate 与 conflicts', async () => {
    const candidate = makeEntry({ content: '明天下午两点开会讨论新项目' })
    const existing = makeExisting({ content: '明天下午两点开会' })
    const info = await buildDedupeInfo(candidate, [existing], NOW)
    expect(info.duplicate?.action).toBe('merge')
    expect(info.conflicts).toHaveLength(1)
  })
})
