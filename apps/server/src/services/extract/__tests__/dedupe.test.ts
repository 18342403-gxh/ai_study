import { describe, it, expect } from 'vitest'
import {
  buildDedupeInfo,
  findExactDuplicate,
  findTimeConflicts,
  intervalsOverlap,
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

describe('buildDedupeInfo', () => {
  it('内容完全一致时直接判为重复（不调用 embedding）', async () => {
    const info = await buildDedupeInfo(makeEntry(), [makeExisting()], NOW)
    expect(info.duplicate).toEqual({ entryId: 'e1', title: '开会', similarity: 1 })
    expect(info.conflicts).toHaveLength(1)
  })
})
