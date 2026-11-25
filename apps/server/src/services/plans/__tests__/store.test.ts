/**
 * 长期规划存储层单测
 *
 * 覆盖：CRUD、stages/progress 归一化、旧 plan 条目转换（幂等 + 归档）。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeTestDatabase, resetTestDatabase } from '../../../../tests/helpers/db.js'

let db: typeof import('../../../db/index.js')
let store: typeof import('../store.js')

beforeAll(async () => {
  db = await import('../../../db/index.js')
  store = await import('../store.js')
})

beforeEach(resetTestDatabase)
afterAll(closeTestDatabase)

describe('plans store', () => {
  it('创建时归一化 stages 与 progress', async () => {
    const plan = await store.createPlan({
      title: '  三个月学习规划  ',
      goal: '掌握 TypeScript',
      progress: 180,
      libraryId: 'store',
      stages: [
        { title: ' 基础语法 ', description: ' 每天 1 小时 ' },
        { title: '   ' },
        { title: '项目实战', targetAt: 1_800_000_000_000, done: true },
      ],
    })

    expect(plan.title).toBe('三个月学习规划')
    expect(plan.progress).toBe(100)
    expect(plan.stages).toHaveLength(2)
    expect(plan.stages[0].id).toBeTruthy()
    expect(plan.stages[0].description).toBe('每天 1 小时')
    expect(plan.stages[1].done).toBe(true)
  })

  it('列表按状态过滤，更新与删除生效', async () => {
    const plan = await store.createPlan({
      title: '英语提升',
      goal: '通过六级',
      libraryId: 'store',
      status: 'active',
    })
    await store.createPlan({
      title: '旧规划',
      libraryId: 'store',
      status: 'archived',
    })

    const active = await store.listPlans({ status: 'active', libraryId: 'store' })
    expect(active.some((item) => item.id === plan.id)).toBe(true)
    expect(active.every((item) => item.status === 'active')).toBe(true)

    const updated = await store.updatePlan(plan.id, {
      title: '英语六级',
      progress: 40,
      stages: [{ title: '背单词' }],
      status: 'done',
    })
    expect(updated?.title).toBe('英语六级')
    expect(updated?.progress).toBe(40)
    expect(updated?.stages[0].title).toBe('背单词')
    expect(updated?.status).toBe('done')

    expect(await store.deletePlan(plan.id)).toBe(true)
    expect(await store.getPlan(plan.id)).toBeNull()
    expect(await store.deletePlan(plan.id)).toBe(false)
  })

  it('旧 plan 条目转换幂等，并把原条目归档', async () => {
    const now = new Date()
    await db
      .getDb()
      .insert(db.tables.entries)
      .values({
        id: '00000000-0000-4000-8000-000000000002',
        userId: 'local',
        libraryId: 'store',
        type: 'plan',
        title: '年度读书计划',
        content: '读完 24 本书',
        status: 'active',
        startAt: now,
        endAt: new Date(now.getTime() + 365 * 24 * 3_600_000),
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

    const first = await store.convertEntryToPlan('00000000-0000-4000-8000-000000000002', {
      userId: 'local',
      libraryId: 'store',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.alreadyConverted).toBe(false)
    expect(first.plan.title).toBe('年度读书计划')
    expect(first.plan.sourceRef).toBe('00000000-0000-4000-8000-000000000002')

    const rows = await db
      .getDb()
      .select()
      .from(db.tables.entries)
      .where(eq(db.tables.entries.id, '00000000-0000-4000-8000-000000000002'))
    expect(rows[0]?.status).toBe('archived')

    const second = await store.convertEntryToPlan('00000000-0000-4000-8000-000000000002', {
      userId: 'local',
      libraryId: 'store',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.alreadyConverted).toBe(true)
    expect(second.plan.id).toBe(first.plan.id)

    expect(
      await store.convertEntryToPlan('00000000-0000-4000-8000-000000000003', {
        userId: 'local',
        libraryId: 'store',
      }),
    ).toEqual({
      ok: false,
      reason: 'ENTRY_NOT_FOUND',
    })
  })
})
