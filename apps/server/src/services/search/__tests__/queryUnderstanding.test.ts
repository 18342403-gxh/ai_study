/**
 * 查询理解单测 — spec 4.5.1
 *
 * 覆盖：规则时间窗口、个人上下文判定、模型结果解析、失败降级。
 */

import { describe, it, expect } from 'vitest'

import { detectTimeWindow, ruleBasedUnderstanding, understandQuery } from '../queryUnderstanding.js'
import { addLocalDays, startOfLocalDay } from '../../extract/timeParse.js'

/** 2026-11-06（周五）10:00 本地时间 */
const NOW = new Date(2026, 10, 6, 10, 0).getTime()
const TODAY = startOfLocalDay(NOW)
const DAY = 86_400_000

describe('detectTimeWindow', () => {
  it('今天 / 明天 / 后天 / 大后天', () => {
    expect(detectTimeWindow('我今天要做什么', NOW)).toEqual({
      start: TODAY,
      end: addLocalDays(TODAY, 1),
    })
    expect(detectTimeWindow('明天有什么安排', NOW)).toEqual({
      start: addLocalDays(TODAY, 1),
      end: addLocalDays(TODAY, 2),
    })
    expect(detectTimeWindow('后天开会', NOW)).toEqual({
      start: addLocalDays(TODAY, 2),
      end: addLocalDays(TODAY, 3),
    })
    expect(detectTimeWindow('大后天交方案', NOW)).toEqual({
      start: addLocalDays(TODAY, 3),
      end: addLocalDays(TODAY, 4),
    })
  })

  it('本周 / 下周 / 上周按周一起算', () => {
    // 2026-11-06 是周五 → 本周一 11-02
    const weekStart = addLocalDays(TODAY, -4)
    expect(detectTimeWindow('这周有什么安排', NOW)).toEqual({
      start: weekStart,
      end: addLocalDays(weekStart, 7),
    })
    expect(detectTimeWindow('下周的计划', NOW)).toEqual({
      start: addLocalDays(weekStart, 7),
      end: addLocalDays(weekStart, 14),
    })
    expect(detectTimeWindow('上周做了什么', NOW)).toEqual({
      start: addLocalDays(weekStart, -7),
      end: weekStart,
    })
  })

  it('最近 N 天（含今天）', () => {
    expect(detectTimeWindow('最近三天学了什么', NOW)).toEqual({
      start: addLocalDays(TODAY, -2),
      end: addLocalDays(TODAY, 1),
    })
    expect(detectTimeWindow('过去 7 天', NOW)).toEqual({
      start: addLocalDays(TODAY, -6),
      end: addLocalDays(TODAY, 1),
    })
  })

  it('本月 / 上个月', () => {
    const monthStart = new Date(2026, 10, 1).getTime()
    expect(detectTimeWindow('这个月有哪些事', NOW)).toEqual({
      start: monthStart,
      end: new Date(2026, 11, 1).getTime(),
    })
    expect(detectTimeWindow('上个月的记录', NOW)).toEqual({
      start: new Date(2026, 9, 1).getTime(),
      end: monthStart,
    })
  })

  it('无时间语义返回 null', () => {
    expect(detectTimeWindow('我习惯用什么语言', NOW)).toBeNull()
  })
})

describe('ruleBasedUnderstanding', () => {
  it('含个人线索 → 需要个人上下文', () => {
    expect(ruleBasedUnderstanding('我最近在学什么', NOW).needsPersonalContext).toBe(true)
    expect(ruleBasedUnderstanding('下周有什么安排', NOW).needsPersonalContext).toBe(true)
  })

  it('通用知识问题 → 跳过个人检索', () => {
    expect(ruleBasedUnderstanding('什么是闭包', NOW).needsPersonalContext).toBe(false)
    expect(ruleBasedUnderstanding('解释一下事件循环', NOW).needsPersonalContext).toBe(false)
  })

  it('规则解析带出时间窗口与全部类型', () => {
    const result = ruleBasedUnderstanding('这周有什么安排', NOW)
    expect(result.source).toBe('rules')
    expect(result.timeRange).not.toBeNull()
    expect(result.entityTypes).toEqual(['schedule', 'plan', 'fact', 'note'])
  })
})

describe('understandQuery', () => {
  it('解析模型返回的 JSON', async () => {
    const result = await understandQuery({
      query: '下周要做什么',
      now: NOW,
      invoke: async () =>
        JSON.stringify({
          needsPersonalContext: true,
          timeRange: { start: '2026-11-09 00:00', end: '2026-11-16 00:00' },
          keywords: ['方案', '会议'],
          entityTypes: ['schedule', 'plan'],
        }),
    })

    expect(result.source).toBe('llm')
    expect(result.needsPersonalContext).toBe(true)
    expect(result.timeRange).toEqual({
      start: new Date(2026, 10, 9).getTime(),
      end: new Date(2026, 10, 16).getTime(),
    })
    expect(result.keywords).toEqual(['方案', '会议'])
    expect(result.entityTypes).toEqual(['schedule', 'plan'])
  })

  it('模型输出非法 → 降级规则解析', async () => {
    const result = await understandQuery({
      query: '这周有什么安排',
      now: NOW,
      invoke: async () => '我不知道',
    })

    expect(result.source).toBe('rules')
    expect(result.timeRange).toEqual(expect.objectContaining({ start: addLocalDays(TODAY, -4) }))
  })

  it('模型调用抛错 → 降级规则解析', async () => {
    const result = await understandQuery({
      query: '我最近在读什么',
      now: NOW,
      invoke: async () => {
        throw new Error('llm down')
      },
    })

    expect(result.source).toBe('rules')
    expect(result.needsPersonalContext).toBe(true)
  })

  it('模型只给日期的窗口按本地 00:00 解析', async () => {
    const result = await understandQuery({
      query: '11 月 11 日有什么事',
      now: NOW,
      invoke: async () =>
        '```json\n{"needsPersonalContext":true,"timeRange":{"start":"2026-11-11","end":"2026-11-12"},"keywords":[],"entityTypes":["schedule"]}\n```',
    })

    expect(result.source).toBe('llm')
    const range = result.timeRange!
    expect(range.start).toBe(new Date(2026, 10, 11).getTime())
    expect(range.end - range.start).toBe(DAY)
  })
})
