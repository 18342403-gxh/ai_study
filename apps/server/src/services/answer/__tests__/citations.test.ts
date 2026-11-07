/**
 * 结构化引用单测 — spec 4.7.3 / 4.8
 */

import { describe, expect, it } from 'vitest'

import { assembleContext } from '../context.js'
import { buildCitations } from '../citations.js'
import type { SearchResultItem, SearchSummary } from '../../search/merge.js'

const TZ = 'Asia/Shanghai'
const CREATED = new Date(2026, 10, 6, 9, 0).getTime()

const entry = (over: Partial<SearchResultItem> = {}): SearchResultItem => ({
  key: 'entry:e1',
  kind: 'entry',
  source: 'time',
  entryId: 'e1',
  type: 'schedule',
  title: '提交 v5 方案',
  content: '下周三下午两点前提交',
  startAt: new Date(2026, 10, 11, 14, 0).getTime(),
  endAt: null,
  occurrence: false,
  createdAt: CREATED,
  score: 1.3,
  channelScore: 1,
  ...over,
})

const chunk = (): SearchResultItem => ({
  key: 'chunk:d1:3',
  kind: 'chunk',
  source: 'semantic',
  docId: 'd1',
  chunkId: 'c3',
  chunkIndex: 3,
  title: '',
  content: '构建流程使用 Vite',
  startAt: null,
  endAt: null,
  occurrence: false,
  createdAt: null,
  score: 0.8,
  channelScore: 0.8,
})

const summary: SearchSummary = {
  total: 20,
  shown: 15,
  remaining: 5,
  byType: { plan: 3 },
  docChunks: 2,
  text: '另有 5 条相关记录（3 条规划、2 条文档片段），已合并',
}

describe('buildCitations', () => {
  it('条目引用：编号与注入一致，带类型/时间快照', () => {
    const assembled = assembleContext({
      results: [entry()],
      summary: null,
      docNames: new Map(),
      timezone: TZ,
    })
    const citations = buildCitations(assembled, null, new Map())

    expect(citations).toHaveLength(1)
    expect(citations[0]).toMatchObject({
      num: 1,
      type: 'entry',
      id: 'e1',
      entryType: 'schedule',
      label: '提交 v5 方案',
      occurrence: false,
    })
    expect(citations[0].type === 'entry' && citations[0].startAt).not.toBeNull()
  })

  it('文档块引用：带 docId/docName/chunkIndex', () => {
    const assembled = assembleContext({
      results: [entry(), chunk()],
      summary: null,
      docNames: new Map([['d1', '项目笔记']]),
      timezone: TZ,
    })
    const citations = buildCitations(assembled, null, new Map([['d1', '项目笔记']]))

    expect(citations[1]).toMatchObject({
      num: 2,
      type: 'chunk',
      id: 'c3',
      docId: 'd1',
      docName: '项目笔记',
      chunkIndex: 3,
    })
  })

  it('汇总行计入引用列表（4.6.2）', () => {
    const assembled = assembleContext({
      results: [entry()],
      summary,
      docNames: new Map(),
      timezone: TZ,
    })
    const citations = buildCitations(assembled, summary, new Map())

    const last = citations[citations.length - 1]
    expect(last).toMatchObject({
      num: 16,
      type: 'summary',
      remaining: 5,
      docChunks: 2,
    })
  })

  it('snippet 超长截断', () => {
    const longEntry = entry({ content: '长'.repeat(300) })
    const assembled = assembleContext({
      results: [longEntry],
      summary: null,
      docNames: new Map(),
      timezone: TZ,
    })
    const citations = buildCitations(assembled, null, new Map())
    const first = citations[0]
    expect(first.type === 'entry' && first.snippet.length <= 120).toBe(true)
  })
})
