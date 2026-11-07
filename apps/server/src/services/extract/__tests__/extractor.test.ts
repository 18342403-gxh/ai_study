import { describe, it, expect } from 'vitest'
import { extractEntries, parseLooseJson } from '../extractor.js'
import { formatDateTime } from '../timeParse.js'

/** 固定基准：2026-11-07（周六）10:00 本地时间 */
const NOW = new Date(2026, 10, 7, 10, 0, 0).getTime()
const at = (day: number, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute, 0).getTime()

const json = (payload: unknown) => JSON.stringify(payload)

describe('parseLooseJson', () => {
  it('解析裸 JSON', () => {
    expect(parseLooseJson('{"intent":"chat","entries":[]}')).toEqual({
      intent: 'chat',
      entries: [],
    })
  })

  it('去掉 Markdown 代码围栏', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('从混杂文本中截取 JSON 对象', () => {
    expect(parseLooseJson('好的，结果如下：{"intent":"record"} 以上')).toEqual({
      intent: 'record',
    })
  })

  it('无法解析时返回 null', () => {
    expect(parseLooseJson('抱歉，我无法处理')).toBeNull()
  })
})

describe('extractEntries', () => {
  it('解析合法 JSON 并补齐时间字段', async () => {
    const outcome = await extractEntries({
      text: '下周三下午两点交方案',
      now: NOW,
      invoke: async () =>
        json({
          intent: 'record',
          entries: [
            {
              type: 'schedule',
              title: '交方案',
              content: '下周三下午两点交方案',
              time: {
                raw: '下周三下午两点',
                start: '2026-11-11T14:00:00+08:00',
                end: null,
                confidence: 0.92,
              },
              confidence: 0.9,
              duplicateHint: null,
            },
          ],
          reply: '已记录',
        }),
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.intent).toBe('record')
    expect(outcome.entries).toHaveLength(1)
    const entry = outcome.entries[0]
    expect(entry.type).toBe('schedule')
    expect(entry.time?.start).toBe(Date.UTC(2026, 10, 11, 6, 0, 0))
    expect(entry.time?.startText).toBe(formatDateTime(Date.UTC(2026, 10, 11, 6, 0, 0)))
    expect(entry.needsReview).toBe(false)
  })

  it('每周一早上九点 → WEEKLY + MO + 09:00', async () => {
    const outcome = await extractEntries({
      text: '每周一早上九点开周会',
      now: NOW,
      invoke: async () =>
        json({
          intent: 'record',
          entries: [
            {
              type: 'schedule',
              title: '周会',
              content: '每周一早上九点开周会',
              time: { raw: '每周一早上九点', start: null, end: null },
              recurrence: { freq: 'WEEKLY', byWeekday: ['MO'] },
              confidence: 0.9,
            },
          ],
        }),
    })

    const entry = outcome.entries[0]
    expect(entry.time?.start).toBe(at(9, 9))
    expect(entry.recurrence?.freq).toBe('WEEKLY')
    expect(entry.recurrence?.byWeekday).toEqual(['MO'])
    expect(entry.recurrenceText).toContain('每周一 09:00')
  })

  it('非 JSON 时重试一次', async () => {
    let calls = 0
    const outcome = await extractEntries({
      text: '明天下午三点开会',
      now: NOW,
      invoke: async () => {
        calls++
        return calls === 1 ? '好的，我帮你记下了' : json({ intent: 'record', entries: [] })
      },
    })

    expect(calls).toBe(2)
    expect(outcome.ok).toBe(true)
    expect(outcome.intent).toBe('record')
    expect(outcome.entries).toHaveLength(0)
  })

  it('两次都非 JSON 时降级并保留原文', async () => {
    const outcome = await extractEntries({
      text: '明天下午三点开会',
      now: NOW,
      invoke: async () => '不是 JSON',
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failed).toBe('non_json')
    expect(outcome.entries).toHaveLength(0)
    expect(outcome.rawText).toBe('明天下午三点开会')
    expect(outcome.reply).toContain('没能整理成记录')
  })

  it('超时后直接降级', async () => {
    const outcome = await extractEntries({
      text: '明天下午三点开会',
      now: NOW,
      timeoutMs: 20,
      invoke: () => new Promise<string>(() => {}),
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failed).toBe('timeout')
    expect(outcome.rawText).toBe('明天下午三点开会')
  })

  it('字段缺失时 confidence=0.3 且需要核对', async () => {
    const outcome = await extractEntries({
      text: '我喜欢喝咖啡',
      now: NOW,
      invoke: async () =>
        json({
          intent: 'record',
          entries: [{ content: '我喜欢喝咖啡' }],
        }),
    })

    const entry = outcome.entries[0]
    expect(entry.type).toBe('note')
    expect(entry.title).toBe('我喜欢喝咖啡')
    expect(entry.confidence).toBe(0.3)
    expect(entry.needsReview).toBe(true)
    expect(entry.warnings.join()).toContain('字段不完整')
  })

  it('没有时间时 schedule 降级为 plan', async () => {
    const outcome = await extractEntries({
      text: '下周要交方案',
      now: NOW,
      invoke: async () =>
        json({
          intent: 'record',
          entries: [
            {
              type: 'schedule',
              title: '交方案',
              content: '下周要交方案',
              time: { raw: '下周', start: null, end: null },
              confidence: 0.8,
            },
          ],
        }),
    })

    const entry = outcome.entries[0]
    expect(entry.time).toBeNull()
    expect(entry.type).toBe('plan')
    expect(entry.warnings.join()).toContain('降级为计划')
  })

  it('超过 5 条时截断并提示剩余数量', async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      type: 'fact',
      title: `事实 ${i + 1}`,
      content: `内容 ${i + 1}`,
      confidence: 0.9,
    }))

    const outcome = await extractEntries({
      text: '一些事实',
      now: NOW,
      invoke: async () => json({ intent: 'record', entries }),
    })

    expect(outcome.entries).toHaveLength(5)
    expect(outcome.truncated).toBe(true)
    expect(outcome.remaining).toBe(1)
  })

  it('过去时间会提示核对', async () => {
    const outcome = await extractEntries({
      text: '昨天下午两点开会',
      now: NOW,
      invoke: async () =>
        json({
          intent: 'record',
          entries: [
            {
              type: 'schedule',
              title: '开会',
              content: '昨天下午两点开会',
              time: {
                raw: '昨天下午两点',
                start: '2026-11-06T14:00:00+08:00',
                end: null,
              },
              confidence: 0.9,
            },
          ],
        }),
    })

    const entry = outcome.entries[0]
    expect(entry.warnings.join()).toContain('时间已过去')
    expect(entry.needsReview).toBe(true)
  })

  it('重复事件开始时间在过去时对齐到下一次', async () => {
    const outcome = await extractEntries({
      text: '每周一早上九点开周会',
      now: NOW,
      invoke: async () =>
        json({
          intent: 'record',
          entries: [
            {
              type: 'schedule',
              title: '周会',
              content: '每周一早上九点开周会',
              time: {
                raw: '每周一早上九点',
                start: new Date(at(2, 9)).toISOString(),
                end: null,
              },
              recurrence: { freq: 'WEEKLY', byWeekday: ['MO'] },
              confidence: 0.9,
            },
          ],
        }),
    })

    const entry = outcome.entries[0]
    expect(entry.time?.start).toBe(at(9, 9))
    expect(entry.warnings.join()).toContain('对齐到下一次')
  })

  it('模型给错星期时按原文校正', async () => {
    const outcome = await extractEntries({
      text: '下周三下午两点交方案',
      now: NOW,
      invoke: async () =>
        json({
          intent: 'record',
          entries: [
            {
              type: 'schedule',
              title: '交方案',
              content: '下周三下午两点交方案',
              // 模型错把「下周三」算成 11-10（周二）
              time: {
                raw: '下周三下午两点',
                start: '2026-11-10T14:00:00+08:00',
                end: '2026-11-10T15:00:00+08:00',
              },
              confidence: 0.9,
            },
          ],
        }),
    })

    const entry = outcome.entries[0]
    expect(entry.time?.start).toBe(at(11, 14))
    // 结束时间随开始时间同步平移，保持原时长
    expect(entry.time?.end).toBe(at(11, 15))
    expect(entry.warnings.join()).toContain('已按原文校正')
  })

  it('原文没有重复线索时忽略模型给出的 recurrence', async () => {
    const outcome = await extractEntries({
      text: '下周三下午两点交方案',
      now: NOW,
      invoke: async () =>
        json({
          intent: 'record',
          entries: [
            {
              type: 'schedule',
              title: '交方案',
              content: '下周三下午两点交方案',
              time: {
                raw: '下周三下午两点',
                start: '2026-11-11T14:00:00+08:00',
                end: null,
              },
              // 模型把一次性的「下周三」误判成每周三
              recurrence: { freq: 'WEEKLY' },
              confidence: 0.9,
            },
          ],
        }),
    })

    const entry = outcome.entries[0]
    expect(entry.recurrence).toBeNull()
    expect(entry.warnings.join()).toContain('原文未表达重复')
  })
})
