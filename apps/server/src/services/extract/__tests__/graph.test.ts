/**
 * 抽取图单测 — Task 3 / AC-4 / AC-6 / AC-7
 *
 * 覆盖：
 *   1. 中断 → resume → 入库成功（条件边 / 检查点 / commit）
 *   2. cancel 意图直接 END，不改卡片
 *   3. 进程重启后仅凭 threadId 从检查点恢复并完成入库
 *   4. 纯函数路由：extract → match/buildCards/finish
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeTestDatabase, resetTestDatabase } from '../../../../tests/helpers/db.js'

const RECORD_JSON = JSON.stringify({
  intent: 'record',
  reply: '已整理出 1 条记录',
  entries: [
    {
      type: 'fact',
      title: '技术偏好',
      content: '喜欢用 TypeScript 写代码',
      confidence: 0.9,
    },
  ],
})

const mockInvoke = async (): Promise<string> => RECORD_JSON

const resumePayload = (key: string) => ({
  cards: [
    {
      key,
      action: 'create' as const,
      payload: {
        type: 'fact' as const,
        title: '技术偏好',
        content: '喜欢用 TypeScript 写代码',
        startAt: null,
        endAt: null,
        recurrence: null,
        confidence: 0.9,
      },
    },
  ],
})

let db: typeof import('../../../db/index.js')
let checkpointer: typeof import('../../graph/checkpointer.js')
let extractGraph: typeof import('../graph.js')

const baseInput = () => ({
  text: '记录一下我喜欢用 TypeScript 写代码',
  sessionId: null,
  libraryId: 'test',
  nowMs: Date.now(),
  timezone: 'Asia/Shanghai',
  invoke: mockInvoke,
})

const rowsOf = async (libraryId: string) =>
  db.getDb().select().from(db.tables.entries).where(eq(db.tables.entries.libraryId, libraryId))

beforeAll(async () => {
  db = await import('../../../db/index.js')
  checkpointer = await import('../../graph/checkpointer.js')
  extractGraph = await import('../graph.js')
})

beforeEach(resetTestDatabase)
afterAll(closeTestDatabase)

describe('routeAfterExtract', () => {
  const outcome = (intent: string, failed: string | null = null) => ({ intent, failed }) as never

  it('cancel / delete / update → match', () => {
    expect(extractGraph.routeAfterExtract({ outcome: outcome('cancel') })).toBe('match')
    expect(extractGraph.routeAfterExtract({ outcome: outcome('delete') })).toBe('match')
    expect(extractGraph.routeAfterExtract({ outcome: outcome('update') })).toBe('match')
  })

  it('record → buildCards，失败 → finish', () => {
    expect(extractGraph.routeAfterExtract({ outcome: outcome('record') })).toBe('buildCards')
    expect(extractGraph.routeAfterExtract({ outcome: outcome('chat', 'non_json') })).toBe('finish')
  })

  it('routeAfterCards：有卡片 → confirm，无卡片 → finish', () => {
    expect(extractGraph.routeAfterCards({ pendingCards: [{ key: '0-a' }] as never })).toBe(
      'confirm',
    )
    expect(extractGraph.routeAfterCards({ pendingCards: [] })).toBe('finish')
  })

  it('routeAtStart：已带文档卡片 → confirm，否则 → extract', () => {
    expect(extractGraph.routeAtStart({ pendingCards: [{ key: 'doc-0-a' }] as never })).toBe(
      'confirm',
    )
    expect(extractGraph.routeAtStart({ pendingCards: [] })).toBe('extract')
  })
})

describe('抽取图中断与恢复', () => {
  it('中断 → resume → 入库成功', async () => {
    const first = await extractGraph.runExtractGraph(baseInput())
    expect(first.interrupted).toBe(true)
    expect(first.threadId).toBe(`extract:${first.draftId}`)
    expect(first.cards).toHaveLength(1)
    expect(first.cards[0].key).toBeTruthy()

    const draft = await extractGraph.readExtractDraft(first.threadId)
    expect(draft?.cards).toHaveLength(1)

    const resumed = await extractGraph.resumeExtractGraph(
      first.threadId,
      resumePayload(first.cards[0].key),
    )
    expect(resumed.interrupted).toBe(false)
    expect(resumed.committed.created).toBe(1)

    const rows = await rowsOf('test')
    expect(rows.some((row) => row.title === '技术偏好' && row.status === 'active')).toBe(true)

    // 处理完成后草稿不再可读
    expect(await extractGraph.readExtractDraft(first.threadId)).toBeNull()
  })

  it('cancel 意图直接 END，不产生待确认卡片', async () => {
    const dbc = db.getDb()
    const now = new Date()
    await dbc.insert(db.tables.entries).values({
      id: '00000000-0000-4000-8000-000000000001',
      userId: 'local',
      libraryId: 'test',
      type: 'schedule',
      title: '周会',
      content: '周会',
      status: 'active',
      startAt: now,
      endAt: new Date(now.getTime() + 3_600_000),
      recurrence: null,
      recurrenceUntil: null,
      exceptions: null,
      sourceType: 'manual',
      sourceRef: null,
      confidence: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })

    const cancelInvoke = async (): Promise<string> =>
      JSON.stringify({
        intent: 'cancel',
        reply: '',
        entries: [{ type: 'schedule', title: '周会', content: '周会' }],
      })

    const result = await extractGraph.runExtractGraph({ ...baseInput(), invoke: cancelInvoke })
    expect(result.interrupted).toBe(false)
    expect(result.reply).toContain('已取消')

    const rows = await rowsOf('test')
    expect(rows.find((row) => row.id === '00000000-0000-4000-8000-000000000001')?.status).toBe(
      'archived',
    )
  })

  it('进程重启后仅凭 threadId 从检查点恢复', async () => {
    const first = await extractGraph.runExtractGraph(baseInput())
    expect(first.interrupted).toBe(true)

    // 模拟进程重启：释放检查点单例与编译缓存，重开业务库
    await checkpointer.closeCheckpointer()
    extractGraph.resetExtractGraph()
    await db.closeDatabase()
    await db.initDatabase()

    const resumed = await extractGraph.resumeExtractGraph(
      first.threadId,
      resumePayload(first.cards[0].key),
    )
    expect(resumed.interrupted).toBe(false)
    expect(resumed.committed.created).toBe(1)

    const rows = await rowsOf('test')
    expect(rows.filter((row) => row.title === '技术偏好')).toHaveLength(1)
  })

  it('文档草稿：直接从 confirm 挂起，可逐条 resume 入库', async () => {
    const docCard = (title: string, content: string) => ({
      type: 'fact' as const,
      title,
      content,
      time: null,
      recurrence: null,
      recurrenceText: null,
      confidence: 0.8,
      needsReview: false,
      duplicateHint: null,
      warnings: [],
      duplicate: null,
      conflicts: [],
    })

    const draft = await extractGraph.runDocumentDraftGraph({
      libraryId: 'doc-test',
      sessionId: null,
      cards: [docCard('文档事实一', '内容一'), docCard('文档事实二', '内容二')],
      nowMs: Date.now(),
      timezone: 'Asia/Shanghai',
    })
    expect(draft.interrupted).toBe(true)
    expect(draft.threadId).toBe(`extract:${draft.draftId}`)
    expect(draft.cards).toHaveLength(2)
    expect(await extractGraph.readExtractDraft(draft.threadId)).not.toBeNull()

    // 只处理第一条：仍剩一条，再次中断
    const partial = await extractGraph.resumeExtractGraph(draft.threadId, {
      cards: [
        {
          key: draft.cards[0].key,
          action: 'skip',
          payload: { type: 'fact', title: '文档事实一', content: '内容一' },
        },
      ],
    })
    expect(partial.interrupted).toBe(true)
    expect(partial.cards).toHaveLength(1)

    // 处理剩余：结束并入库
    const rest = await extractGraph.resumeExtractGraph(draft.threadId, {
      cards: [
        {
          key: partial.cards[0].key,
          action: 'create',
          payload: { type: 'fact', title: '文档事实二', content: '内容二' },
        },
      ],
    })
    expect(rest.interrupted).toBe(false)
    expect(rest.committed.created).toBe(1)
    expect(await extractGraph.readExtractDraft(draft.threadId)).toBeNull()

    const rows = await rowsOf('doc-test')
    expect(rows.some((row) => row.title === '文档事实二')).toBe(true)
  })
})
