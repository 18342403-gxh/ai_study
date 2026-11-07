/**
 * 上下文组装单测 — spec 4.6
 *
 * 覆盖：编号注入格式、时间/录入于展示、字符预算截断、汇总行编号。
 */

import { describe, expect, it } from 'vitest'

import { assembleContext } from '../context.js'
import type { SearchResultItem, SearchSummary } from '../../search/merge.js'

const TZ = 'Asia/Shanghai'
const BASE = new Date(2026, 10, 11, 14, 0).getTime() // 2026-11-11 14:00
const CREATED = new Date(2026, 10, 6, 9, 0).getTime() // 2026-11-06

const makeItem = (over: Partial<SearchResultItem> = {}): SearchResultItem => ({
  key: `entry:${over.entryId ?? 'e1'}`,
  kind: 'entry',
  source: 'semantic',
  entryId: 'e1',
  type: 'fact',
  title: '偏好使用 TypeScript',
  content: '我习惯 TypeScript，不喜欢过度封装',
  startAt: null,
  endAt: null,
  occurrence: false,
  createdAt: CREATED,
  score: 1,
  channelScore: 1,
  ...over,
})

const makeChunk = (over: Partial<SearchResultItem> = {}): SearchResultItem => ({
  key: 'chunk:d1:3',
  kind: 'chunk',
  source: 'semantic',
  docId: 'd1',
  chunkId: 'c3',
  chunkIndex: 3,
  title: '',
  content: '构建流程使用 Vite，配置见 build.config.ts',
  startAt: null,
  endAt: null,
  occurrence: false,
  createdAt: null,
  score: 0.8,
  channelScore: 0.8,
  ...over,
})

const makeSummary = (over: Partial<SearchSummary> = {}): SearchSummary => ({
  total: 20,
  shown: 15,
  remaining: 5,
  byType: { plan: 3 },
  docChunks: 2,
  text: '另有 5 条相关记录（3 条规划、2 条文档片段），已合并',
  ...over,
})

describe('assembleContext', () => {
  it('空结果 → 空文本（4.6.3 不注入空标题）', () => {
    const assembled = assembleContext({
      results: [],
      summary: null,
      docNames: new Map(),
      timezone: TZ,
    })
    expect(assembled.text).toBe('')
    expect(assembled.numbered).toEqual([])
    expect(assembled.summaryNum).toBeNull()
  })

  it('条目行：[类型] 标题 内容（录入于 日期），日程带绝对时间', () => {
    const schedule = makeItem({
      entryId: 'e2',
      type: 'schedule',
      title: '提交 v5 方案',
      content: '',
      startAt: BASE,
      endAt: BASE + 60 * 60 * 1000,
    })
    const assembled = assembleContext({
      results: [schedule, makeItem()],
      summary: null,
      docNames: new Map(),
      timezone: TZ,
    })

    expect(assembled.text).toContain('[个人记录]')
    expect(assembled.text).toContain(
      '1. [日程] 2026-11-11 周三 14:00-15:00 提交 v5 方案（录入于 2026-11-06）',
    )
    expect(assembled.text).toContain(
      '2. [事实] 偏好使用 TypeScript 我习惯 TypeScript，不喜欢过度封装（录入于 2026-11-06）',
    )
  })

  it('文档块进 [资料片段]，带《文档名》，编号接在条目后', () => {
    const assembled = assembleContext({
      results: [makeItem(), makeChunk()],
      summary: null,
      docNames: new Map([['d1', '项目笔记']]),
      timezone: TZ,
    })

    expect(assembled.text).toContain('[资料片段]')
    expect(assembled.text).toContain('2. 《项目笔记》构建流程使用 Vite')
    expect(assembled.numbered[1].item.kind).toBe('chunk')
  })

  it('文档名缺失时兜底「未命名文档」', () => {
    const assembled = assembleContext({
      results: [makeChunk()],
      summary: null,
      docNames: new Map(),
      timezone: TZ,
    })
    expect(assembled.text).toContain('1. 《未命名文档》')
  })

  it('汇总行固定编号 16 且进 [其他相关]（4.6.2）', () => {
    const assembled = assembleContext({
      results: [makeItem()],
      summary: makeSummary(),
      docNames: new Map(),
      timezone: TZ,
    })
    expect(assembled.summaryNum).toBe(16)
    expect(assembled.text).toContain('[其他相关]\n16. 另有 5 条相关记录')
  })

  it('超长内容按单条预算截断，末尾加省略号', () => {
    const long = makeItem({ content: '很'.repeat(500) })
    const assembled = assembleContext({
      results: [long],
      summary: null,
      docNames: new Map(),
      timezone: TZ,
    })
    const line = assembled.text.split('\n')[1]
    expect(line.length).toBeLessThanOrEqual(160)
    expect(line.endsWith('…')).toBe(true)
  })

  it('总预算超限时低优先级条目不注入也不编号', () => {
    // 单行顶满上限：条目 160 × 10 + 块 400 × 5 = 3600 > 3200，最后的块应被丢弃
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeItem({ entryId: `e${i}`, content: '长'.repeat(500) }),
    )
    const chunks = Array.from({ length: 5 }, (_, i) =>
      makeChunk({
        key: `chunk:d1:${i}`,
        chunkId: `c${i}`,
        chunkIndex: i,
        content: '资'.repeat(500),
      }),
    )
    const assembled = assembleContext({
      results: [...entries, ...chunks],
      summary: null,
      docNames: new Map([['d1', '项目笔记']]),
      timezone: TZ,
    })
    expect(assembled.numbered.length).toBeLessThan(15)
    expect(assembled.numbered.filter((n) => n.item.kind === 'entry')).toHaveLength(10)
  })
})
