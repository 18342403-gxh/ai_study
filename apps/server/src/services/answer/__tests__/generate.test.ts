/**
 * 回答生成单测 — spec 4.7 / 4.9
 *
 * 覆盖：prompt 组装（编号注入 + 硬性规则）、未命中解析、空结果话术、
 * 通用问题路径、超时/失败降级、历史裁剪。
 */

import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '../../chain/model.js'
import type { SearchResultItem } from '../../search/merge.js'
import type { SearchAllOutcome } from '../../search/searchAll.js'
import {
  buildAnswerMessages,
  generateAnswer,
  NOT_FOUND_REPLY,
  parseMissing,
  trimHistory,
} from '../generate.js'

const CREATED = new Date(2026, 10, 6, 9, 0).getTime()

const entryItem = (over: Partial<SearchResultItem> = {}): SearchResultItem => ({
  key: 'entry:e1',
  kind: 'entry',
  source: 'time',
  entryId: 'e1',
  type: 'schedule',
  title: '每周一开周会',
  content: '每周一上午九点开前端周会',
  startAt: new Date(2026, 10, 9, 9, 0).getTime(),
  endAt: null,
  occurrence: true,
  createdAt: CREATED,
  score: 1.3,
  channelScore: 1,
  ...over,
})

const makeSearch = (over: Partial<SearchAllOutcome> = {}): SearchAllOutcome => ({
  understanding: {
    needsPersonalContext: true,
    timeRange: null,
    keywords: [],
    entityTypes: ['schedule'],
    source: 'rules',
  },
  window: null,
  results: [entryItem()],
  summary: null,
  channels: { time: 1, entry: 0, doc: 0 },
  embeddingMock: true,
  empty: false,
  ...over,
})

describe('buildAnswerMessages', () => {
  it('有上下文：system 含硬性规则，user 含编号注入与问题', () => {
    const messages = buildAnswerMessages({
      query: '下周有什么安排',
      contextText: '[个人记录]\n1. [日程] 2026-11-09 周一 09:00 每周一开周会',
      history: [],
      general: false,
    })

    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('必须标注编号')
    const last = messages[messages.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toContain('1. [日程]')
    expect(last.content).toContain('[问题]\n下周有什么安排')
  })

  it('通用问题：system 不含引用规则', () => {
    const messages = buildAnswerMessages({
      query: '什么是 RRF',
      contextText: '',
      history: [],
      general: true,
    })
    expect(messages[0].content).not.toContain('必须标注编号')
  })
})

describe('parseMissing', () => {
  it('剥离末尾「未命中」行并结构化', () => {
    const { reply, missing } = parseMissing('你下周有周会 [1]。\n未命中：Rust 相关记录、健身计划')
    expect(reply).toBe('你下周有周会 [1]。')
    expect(missing).toEqual(['Rust 相关记录', '健身计划'])
  })

  it('没有未命中行时原样返回', () => {
    const { reply, missing } = parseMissing('一切都有记录 [1]。')
    expect(reply).toBe('一切都有记录 [1]。')
    expect(missing).toEqual([])
  })

  it('模型把「未命中」写在句尾同行也能解析，并清理尾部标点', () => {
    const { reply, missing } = parseMissing('只有 11 月 9 日的周会安排。未命中：下周具体安排。')
    expect(reply).toBe('只有 11 月 9 日的周会安排。')
    expect(missing).toEqual(['下周具体安排'])
  })
})

describe('trimHistory', () => {
  it('只保留 user/assistant，最多 12 条', () => {
    const history: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `第 ${i} 条`,
    }))
    history.unshift({ role: 'system', content: 'sys' })
    const trimmed = trimHistory(history)
    expect(trimmed).toHaveLength(12)
    expect(trimmed.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true)
    expect(trimmed[trimmed.length - 1].content).toBe('第 19 条')
  })

  it('超字符预算时丢弃最旧的消息', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '旧'.repeat(1500) },
      { role: 'assistant', content: '旧'.repeat(1500) },
      { role: 'user', content: '新消息' },
    ]
    const trimmed = trimHistory(history)
    expect(trimmed[trimmed.length - 1].content).toBe('新消息')
    expect(trimmed.length).toBeLessThan(3)
  })
})

describe('generateAnswer', () => {
  it('检索为空 → 固定「未找到」话术，不调模型（4.5.5）', async () => {
    let called = 0
    const outcome = await generateAnswer({
      query: '我养了几只猫',
      search: makeSearch({ results: [], empty: true }),
      invoke: async () => {
        called++
        return 'x'
      },
    })

    expect(called).toBe(0)
    expect(outcome.reply).toBe(NOT_FOUND_REPLY)
    expect(outcome.citations).toEqual([])
    expect(outcome.empty).toBe(true)
    expect(outcome.degradedReason).toBe('not_found')
  })

  it('通用问题 → 正常回答，无引用区', async () => {
    const outcome = await generateAnswer({
      query: '什么是 RRF',
      search: makeSearch({
        understanding: {
          needsPersonalContext: false,
          timeRange: null,
          keywords: [],
          entityTypes: [],
          source: 'rules',
        },
        results: [],
        empty: true,
      }),
      invoke: async () => 'RRF 是倒数排名融合……',
    })

    expect(outcome.reply).toBe('RRF 是倒数排名融合……')
    expect(outcome.citations).toEqual([])
    expect(outcome.general).toBe(true)
    expect(outcome.degraded).toBe(false)
  })

  it('命中：模型按编号回答，返回结构化 citations 与 missing', async () => {
    const outcome = await generateAnswer({
      query: '下周有什么安排，顺便推荐下 Rust 资料',
      search: makeSearch(),
      docNames: new Map(),
      invoke: async (messages) => {
        const user = messages[messages.length - 1].content
        expect(user).toContain('1. [日程]')
        expect(user).toContain('每周一开周会')
        return '你下周一 09:00 有前端周会 [1]。\n未命中：Rust 相关记录'
      },
    })

    expect(outcome.reply).toBe('你下周一 09:00 有前端周会 [1]。')
    expect(outcome.missing).toEqual(['Rust 相关记录'])
    expect(outcome.citations).toHaveLength(1)
    expect(outcome.citations[0]).toMatchObject({ num: 1, type: 'entry', id: 'e1' })
    expect(outcome.degraded).toBe(false)
  })

  it('生成超时 → 降级返回检索结果列表，citations 保留（4.9）', async () => {
    const outcome = await generateAnswer({
      query: '下周有什么安排',
      search: makeSearch(),
      docNames: new Map(),
      timeoutMs: 50,
      invoke: () => new Promise((resolve) => setTimeout(() => resolve('太晚'), 500)),
    })

    expect(outcome.degraded).toBe(true)
    expect(outcome.degradedReason).toBe('timeout')
    expect(outcome.reply).toContain('回答生成超时')
    expect(outcome.reply).toContain('每周一开周会')
    expect(outcome.citations).toHaveLength(1)
  })

  it('模型调用失败 → 同样走降级路径', async () => {
    const outcome = await generateAnswer({
      query: '下周有什么安排',
      search: makeSearch(),
      docNames: new Map(),
      invoke: async () => {
        throw new Error('upstream 500')
      },
    })

    expect(outcome.degraded).toBe(true)
    expect(outcome.degradedReason).toBe('llm_error')
    expect(outcome.reply).toContain('回答生成超时')
  })
})
