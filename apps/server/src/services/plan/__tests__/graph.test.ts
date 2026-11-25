/**
 * 长期规划图单测
 *
 * 覆盖：
 *   1. 追问 → 回答 → 草稿 → 确认 → plans 落库
 *   2. 知识库无命中：不追问，直接产出 grounded=false 的通用草稿
 *   3. 放弃草稿：不入库
 *   4. resume 阶段不匹配返回明确错误
 *   5. 进程重启后凭 threadId 从检查点恢复
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, resetTestDatabase } from '../../../../tests/helpers/db.js'

const SOURCE = {
  type: 'entry' as const,
  id: 'entry-1',
  label: 'note · 已报名 TypeScript 课程',
  snippet: '每周三晚上上课，已学完基础语法。',
}

const DRAFT_JSON = JSON.stringify({
  title: '三个月 TypeScript 提升',
  goal: '能独立完成一个全栈项目，并用测试覆盖核心逻辑。',
  startAt: 1_700_000_000_000,
  endAt: 1_708_000_000_000,
  stages: [
    { title: '补齐类型基础', description: '复习泛型与工具类型', targetAt: 1_702_000_000_000 },
    { title: '完成全栈项目', description: '做一个带鉴权的待办应用', targetAt: 1_706_000_000_000 },
  ],
})

const makeInvoke =
  (assess: { needMore: boolean; questions: string[] }) =>
  async (kind: 'assess' | 'draft'): Promise<string> =>
    kind === 'assess' ? JSON.stringify(assess) : DRAFT_JSON

let db: typeof import('../../../db/index.js')
let checkpointer: typeof import('../../graph/checkpointer.js')
let planGraph: typeof import('../graph.js')

const baseInput = () => ({
  goal: '帮我做一个三个月的 TypeScript 学习规划',
  libraryId: 'plan-test',
  nowMs: Date.UTC(2023, 10, 14),
  timezone: 'Asia/Shanghai',
})

beforeAll(async () => {
  db = await import('../../../db/index.js')
  checkpointer = await import('../../graph/checkpointer.js')
  planGraph = await import('../graph.js')
})

beforeEach(resetTestDatabase)
afterAll(closeTestDatabase)

describe('条件边', () => {
  it('routeAfterAssess：有疑问且未追问过 → ask', () => {
    expect(planGraph.routeAfterAssess({ questions: ['多久？'], askRound: 0 })).toBe('ask')
    expect(planGraph.routeAfterAssess({ questions: [], askRound: 0 })).toBe('draft')
    expect(planGraph.routeAfterAssess({ questions: ['多久？'], askRound: 1 })).toBe('draft')
  })

  it('routeAfterConfirm：有草稿 → save，空 → finish', () => {
    expect(planGraph.routeAfterConfirm({ planDraft: { title: 'x' } as never })).toBe('save')
    expect(planGraph.routeAfterConfirm({ planDraft: null })).toBe('finish')
  })
})

describe('规划图中断与恢复', () => {
  it('追问 → 回答 → 草稿 → 确认 → 入库', async () => {
    const invoke = makeInvoke({ needMore: true, questions: ['你希望多久完成？'] })
    const research = async () => ({ notes: '已报名课程，每周三晚上课。', sources: [SOURCE] })

    const first = await planGraph.runPlanGraph({ ...baseInput(), research, invoke })
    expect(first.stage).toBe('ask')
    expect(first.questions).toEqual(['你希望多久完成？'])
    expect(first.threadId).toBe(`plan:${first.draftId}`)
    expect((await planGraph.readPlanDraft(first.threadId))?.stage).toBe('ask')

    const second = await planGraph.resumePlanGraph(
      first.threadId,
      { answers: ['三个月，每周 6 小时'] },
      { research, invoke },
    )
    expect(second.stage).toBe('confirm')
    expect(second.draft?.grounded).toBe(true)
    expect(second.draft?.sources).toHaveLength(1)
    expect(second.draft?.stages).toHaveLength(2)
    expect(second.savedPlan).toBeNull()

    const edited = { ...second.draft!, title: '三个月 TS 进阶计划' }
    const third = await planGraph.resumePlanGraph(
      first.threadId,
      { action: 'confirm', draft: edited },
      { research, invoke },
    )
    expect(third.done).toBe(true)
    expect(third.savedPlan?.title).toBe('三个月 TS 进阶计划')
    expect(third.savedPlan?.progress).toBe(0)
    expect(third.savedPlan?.stages).toHaveLength(2)
    expect(await planGraph.readPlanDraft(first.threadId)).toBeNull()
  })

  it('知识库无命中：不追问，直接生成 grounded=false 草稿', async () => {
    const invoke = makeInvoke({ needMore: false, questions: [] })
    const research = async () => ({ notes: '知识库未检索到相关内容', sources: [] })

    const result = await planGraph.runPlanGraph({ ...baseInput(), research, invoke })
    expect(result.stage).toBe('confirm')
    expect(result.questions).toEqual([])
    expect(result.draft?.grounded).toBe(false)
    expect(result.draft?.sources).toEqual([])
    expect(result.draft?.stages.length).toBeGreaterThan(0)
  })

  it('放弃草稿：不入库', async () => {
    const invoke = makeInvoke({ needMore: false, questions: [] })
    const research = async () => ({ notes: '', sources: [] })

    const first = await planGraph.runPlanGraph({ ...baseInput(), research, invoke })
    expect(first.stage).toBe('confirm')

    const discarded = await planGraph.resumePlanGraph(
      first.threadId,
      { action: 'discard' },
      { research, invoke },
    )
    expect(discarded.done).toBe(true)
    expect(discarded.savedPlan).toBeNull()
    expect(await planGraph.readPlanDraft(first.threadId)).toBeNull()
  })

  it('resume 阶段不匹配：返回 PLAN_RESUME_MISMATCH', async () => {
    const invoke = makeInvoke({ needMore: true, questions: ['多久？'] })
    const research = async () => ({ notes: '', sources: [] })
    const first = await planGraph.runPlanGraph({ ...baseInput(), research, invoke })
    expect(first.stage).toBe('ask')

    await expect(
      planGraph.resumePlanGraph(first.threadId, { action: 'discard' }, { research, invoke }),
    ).rejects.toMatchObject({ code: 'PLAN_RESUME_MISMATCH' })
  })

  it('进程重启后仅凭 threadId 从检查点恢复', async () => {
    const invoke = makeInvoke({ needMore: true, questions: ['你的基础如何？'] })
    const research = async () => ({ notes: '', sources: [] })
    const first = await planGraph.runPlanGraph({ ...baseInput(), research, invoke })
    expect(first.stage).toBe('ask')

    // 模拟进程重启：释放检查点单例与编译缓存，重开业务库
    await checkpointer.closeCheckpointer()
    planGraph.resetPlanGraph()
    await db.closeDatabase()
    await db.initDatabase()

    expect((await planGraph.readPlanDraft(first.threadId))?.stage).toBe('ask')

    const resumed = await planGraph.resumePlanGraph(
      first.threadId,
      { answers: ['零基础'] },
      { research, invoke },
    )
    expect(resumed.stage).toBe('confirm')
    expect(resumed.draft?.title).toBe('三个月 TypeScript 提升')
  })
})
