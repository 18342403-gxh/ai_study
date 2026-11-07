import { describe, it, expect } from 'vitest'
import {
  expandOccurrences,
  nextOccurrenceAfter,
  normalizeRecurrence,
  type Recurrence,
} from '../recurrence.js'
import { addLocalDays } from '../timeParse.js'

/** 固定基准：2026-11-07（周六）10:00 本地时间 */
const NOW = new Date(2026, 10, 7, 10, 0, 0).getTime()
const at = (day: number, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute, 0).getTime()
// 2026-11-02 是周一
const MONDAY = at(2, 9)

describe('normalizeRecurrence', () => {
  it('DAILY 缺省 interval=1，until 缺省为一年后', () => {
    const { recurrence } = normalizeRecurrence({ freq: 'DAILY' }, NOW)
    expect(recurrence?.freq).toBe('DAILY')
    expect(recurrence?.interval).toBe(1)
    expect(recurrence?.until).toBe(addLocalDays(NOW, 365))
  })

  it('DAILY interval 超出范围时截断', () => {
    const { recurrence } = normalizeRecurrence({ freq: 'DAILY', interval: 9999 }, NOW)
    expect(recurrence?.interval).toBe(365)
  })

  it('WEEKLY byWeekday 去重并排序', () => {
    const { recurrence } = normalizeRecurrence(
      { freq: 'WEEKLY', byWeekday: ['FR', 'MO', 'MO'] },
      NOW,
    )
    expect(recurrence?.byWeekday).toEqual(['MO', 'FR'])
  })

  it('WEEKLY 缺少星期时按开始时间推导', () => {
    const { recurrence, warnings } = normalizeRecurrence({ freq: 'WEEKLY' }, NOW, MONDAY)
    expect(recurrence?.byWeekday).toEqual(['MO'])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('MONTHLY 按 byMonthDay 规范化', () => {
    const { recurrence } = normalizeRecurrence({ freq: 'MONTHLY', byMonthDay: 5 }, NOW)
    expect(recurrence?.byMonthDay).toBe(5)
  })

  it('每年重复降级为单次事件', () => {
    const { recurrence, warnings } = normalizeRecurrence({ freq: 'YEARLY' }, NOW)
    expect(recurrence).toBeNull()
    expect(warnings.join()).toContain('暂不支持')
  })

  it('BYSETPOS 降级为单次事件', () => {
    const { recurrence } = normalizeRecurrence({ freq: 'MONTHLY', byMonthDay: 1, bySetPos: 2 }, NOW)
    expect(recurrence).toBeNull()
  })

  it('until 在过去时延长至一年后', () => {
    const { recurrence } = normalizeRecurrence({ freq: 'DAILY', until: at(1) }, NOW)
    expect(recurrence?.until).toBe(addLocalDays(NOW, 365))
  })
})

describe('expandOccurrences', () => {
  const weekly: Recurrence = {
    freq: 'WEEKLY',
    byWeekday: ['MO'],
    until: addLocalDays(NOW, 365),
  }

  it('每周一在窗口内展开并保留时间点', () => {
    const occurrences = expandOccurrences({
      startAt: MONDAY,
      endAt: null,
      recurrence: weekly,
      windowStart: at(1),
      windowEnd: at(30, 23, 59),
    })
    expect(occurrences.map((o) => o.start)).toEqual([
      at(2, 9),
      at(9, 9),
      at(16, 9),
      at(23, 9),
      at(30, 9),
    ])
  })

  it('每两天按起始日计算间隔', () => {
    const occurrences = expandOccurrences({
      startAt: at(2),
      endAt: null,
      recurrence: { freq: 'DAILY', interval: 2, until: addLocalDays(NOW, 365) },
      windowStart: at(1),
      windowEnd: at(9, 23, 59),
    })
    expect(occurrences.map((o) => new Date(o.start).getDate())).toEqual([2, 4, 6, 8])
  })

  it('每个工作日只落在周一至周五', () => {
    const occurrences = expandOccurrences({
      startAt: at(2),
      endAt: null,
      recurrence: {
        freq: 'WEEKLY',
        byWeekday: ['MO', 'TU', 'WE', 'TH', 'FR'],
        until: addLocalDays(NOW, 365),
      },
      windowStart: at(2),
      windowEnd: at(8, 23, 59),
    })
    expect(occurrences).toHaveLength(5)
    for (const occ of occurrences) {
      const day = new Date(occ.start).getDay()
      expect(day).toBeGreaterThanOrEqual(1)
      expect(day).toBeLessThanOrEqual(5)
    }
  })

  it('单规则展开上限为 60', () => {
    const occurrences = expandOccurrences({
      startAt: at(1),
      endAt: null,
      recurrence: { freq: 'DAILY', interval: 1, until: addLocalDays(NOW, 365) },
      windowStart: at(1),
      windowEnd: addLocalDays(NOW, 365),
    })
    expect(occurrences).toHaveLength(60)
  })

  it('事件时长会传递到每个实例', () => {
    const occurrences = expandOccurrences({
      startAt: MONDAY,
      endAt: at(2, 10),
      recurrence: weekly,
      windowStart: at(1),
      windowEnd: at(10, 23, 59),
    })
    expect(occurrences[0].end).toBe(at(2, 10))
    expect(occurrences[1].end).toBe(at(9, 10))
  })
})

describe('nextOccurrenceAfter', () => {
  it('开始时间已过时返回下一次', () => {
    const occurrence = nextOccurrenceAfter(
      MONDAY,
      { freq: 'WEEKLY', byWeekday: ['MO'], until: addLocalDays(NOW, 365) },
      NOW,
    )
    expect(occurrence).toBe(at(9, 9))
  })
})
