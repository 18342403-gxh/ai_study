import { describe, it, expect } from 'vitest'
import { formatDateTime, parseIsoTime, parseRelativeTime, validateTimeRange } from '../timeParse.js'

/** 固定基准：2026-11-07（周六）10:00 本地时间 */
const NOW = new Date(2026, 10, 7, 10, 0, 0).getTime()
const at = (day: number, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute, 0).getTime()

describe('parseIsoTime', () => {
  it('解析带时区的 ISO 时间', () => {
    expect(parseIsoTime('2026-11-11T14:00:00+08:00')).toBe(Date.UTC(2026, 10, 11, 6, 0, 0))
  })

  it('纯日期按本地 00:00 解析', () => {
    expect(parseIsoTime('2026-11-11')).toBe(at(11))
  })

  it('无时区的日期时间按本地时间解析', () => {
    expect(parseIsoTime('2026-11-11T14:30:00')).toBe(at(11, 14, 30))
  })

  it('数字直接当作毫秒时间戳', () => {
    expect(parseIsoTime(NOW)).toBe(NOW)
  })

  it('非法格式返回 null', () => {
    expect(parseIsoTime('下周三下午')).toBeNull()
    expect(parseIsoTime('2026/11/11')).toBeNull()
    expect(parseIsoTime(null)).toBeNull()
  })
})

describe('validateTimeRange', () => {
  it('起止颠倒时丢弃结束时间并提示', () => {
    const result = validateTimeRange(at(11, 14), at(11, 13), NOW)
    expect(result.end).toBeNull()
    expect(result.warnings.join()).toContain('结束时间早于开始时间')
  })

  it('只有结束时间时丢弃并提示', () => {
    const result = validateTimeRange(null, at(11, 14), NOW)
    expect(result.end).toBeNull()
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('开始时间在过去时标记 past', () => {
    const result = validateTimeRange(at(6, 9), null, NOW)
    expect(result.past).toBe(true)
    expect(result.warnings.join()).toContain('时间已过去')
  })

  it('重复事件的过去时间使用不同提示', () => {
    const result = validateTimeRange(at(6, 9), null, NOW, { recurring: true })
    expect(result.warnings.join()).toContain('将按重复规则')
  })
})

describe('parseRelativeTime', () => {
  it('明天下午两点', () => {
    const result = parseRelativeTime('明天下午两点', NOW)
    expect(result?.start).toBe(at(8, 14))
    expect(result?.recurrence).toBeNull()
  })

  it('下周三下午两点', () => {
    const result = parseRelativeTime('下周三下午两点', NOW)
    expect(result?.start).toBe(at(11, 14))
  })

  it('三天后保留当前时刻', () => {
    const result = parseRelativeTime('三天后', NOW)
    expect(result?.start).toBe(new Date(2026, 10, 10, 10, 0, 0).getTime())
  })

  it('每周一早上九点', () => {
    const result = parseRelativeTime('每周一早上九点', NOW)
    expect(result?.start).toBe(at(9, 9))
    expect(result?.recurrence).toEqual({ freq: 'WEEKLY', byWeekday: ['MO'] })
  })

  it('每个工作日默认 00:00 并提示未指定具体时间', () => {
    const result = parseRelativeTime('每个工作日', NOW)
    expect(result?.start).toBe(at(9))
    expect(result?.recurrence).toEqual({
      freq: 'WEEKLY',
      byWeekday: ['MO', 'TU', 'WE', 'TH', 'FR'],
    })
    expect(result?.warnings.join()).toContain('未指定具体时间')
  })

  it('每月 5 号，本月已过则取下月', () => {
    const result = parseRelativeTime('每月5号', NOW)
    expect(result?.start).toBe(new Date(2026, 11, 5, 0, 0, 0).getTime())
    expect(result?.recurrence).toEqual({ freq: 'MONTHLY', byMonthDay: 5 })
  })

  it('只有时间点默认今天并提示', () => {
    const result = parseRelativeTime('下午两点', NOW)
    expect(result?.start).toBe(at(7, 14))
    expect(result?.warnings.join()).toContain('未说明日期')
  })

  it('月底置信度降低', () => {
    const result = parseRelativeTime('月底', NOW)
    expect(result?.start).toBe(at(30))
    expect(result?.confidence).toBeLessThan(0.6)
  })

  it('周五（只有日期无时间）：timeExplicit=false 并提示未指定具体时间', () => {
    const result = parseRelativeTime('周五', NOW)
    // 2026-11-07 是周六，下一个周五是 11-13
    expect(result?.start).toBe(at(13))
    expect(result?.timeExplicit).toBe(false)
    expect(result?.warnings.join()).toContain('未指定具体时间')
    expect(result?.confidence).toBeLessThanOrEqual(0.6)
  })

  it('周五下午三点：timeExplicit=true', () => {
    const result = parseRelativeTime('周五下午三点', NOW)
    expect(result?.start).toBe(at(13, 15))
    expect(result?.timeExplicit).toBe(true)
    expect(result?.warnings.join()).not.toContain('未指定具体时间')
  })

  it('无法识别时返回 null', () => {
    expect(parseRelativeTime('你好', NOW)).toBeNull()
    expect(parseRelativeTime('最近', NOW)).toBeNull()
  })
})

describe('formatDateTime', () => {
  it('按指定时区输出绝对时间', () => {
    expect(formatDateTime(Date.UTC(2026, 10, 7, 2, 0), 'Asia/Shanghai')).toBe(
      '2026-11-07 周六 10:00',
    )
  })
})
