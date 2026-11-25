/**
 * 长期规划图 — 调研 → 评估 →（可选追问）→ 草稿 → 确认 → 入库
 *
 *   START → research → assess ─┬→ ask → assess（回答后直接进入草稿）
 *                              └→ draft → confirm ─┬→ save → finish
 *                                                  └→ finish（放弃）
 *
 * 关键约束（用户明确要求）：
 *   - 规划依据优先来自知识库；知识库未覆盖的部分用通用建议补足，不得虚构个人信息。
 *   - 追问只解决「目标本身不明确」，不因知识库没有内容而追问。
 *   - 草稿通过 interrupt 挂起，前端可编辑后 resume 确认；检查点支持刷新/重启恢复。
 */

import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
  Command,
} from '@langchain/langgraph'
import { randomUUID } from 'crypto'

import type { ChatMessage, FunctionToolDefinition } from '../chain/model.js'
import { invokeChatWithTools } from '../chain/model.js'
import { compileGraph, tracedNode } from '../graph/runtime.js'
import { planThreadId, parseThreadId } from '../graph/thread.js'
import type { GraphNode } from '../graph/types.js'
import { logger } from '../logger.js'
import { getLocalTimezone } from '../extract/timeParse.js'
import { parseLooseJson } from '../extract/extractor.js'
import {
  getPlan,
  insertDraftPlan,
  listActivePlanBriefs,
  normalizeStages,
  type Plan,
  type PlanDraft,
  type PlanSource,
  type PlanStage,
} from '../plans/store.js'
import { createPlanResearchTools } from './tools.js'

// ── 评估 / 草稿的结构化输出工具 ──────────────────────

const ASSESS_TOOL: FunctionToolDefinition = {
  type: 'function',
  function: {
    name: 'assess_plan_info',
    description: '提交对规划目标信息是否充分的评估结果',
    parameters: {
      type: 'object',
      properties: {
        needMore: {
          type: 'boolean',
          description: '目标本身缺少关键参数、确实需要用户补充时为 true',
        },
        questions: {
          type: 'array',
          description: '最多 3 个简短、具体的追问；needMore=false 时为空数组',
          items: { type: 'string' },
        },
      },
      required: ['needMore', 'questions'],
    },
  },
}

const DRAFT_TOOL: FunctionToolDefinition = {
  type: 'function',
  function: {
    name: 'create_plan_draft',
    description: '提交结构化长期规划草稿',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '规划标题，≤30 字' },
        goal: { type: 'string', description: '目标、期望结果与衡量方式' },
        startAt: { type: ['number', 'null'], description: '开始时间（毫秒时间戳）' },
        endAt: { type: ['number', 'null'], description: '结束时间（毫秒时间戳），无法确定时 null' },
        stages: {
          type: 'array',
          description: '阶段/里程碑，按时间顺序，3-8 个',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              targetAt: { type: ['number', 'null'], description: '目标日期（毫秒时间戳）' },
            },
            required: ['title'],
          },
        },
      },
      required: ['title', 'goal', 'stages'],
    },
  },
}

// ── 提示词 ───────────────────────────────────────────

export const PLAN_RESEARCH_SYSTEM = `你是长期规划助手的调研 Agent。先检索个人知识库，找出与用户规划目标相关的真实事实（学习/工作/习惯/日程/兴趣/已有目标/文档资料）。
规则：
1. 需要了解个人情况时调用 search_knowledge，可换关键词多轮检索。
2. 只使用工具返回的真实内容，不得编造个人经历、偏好、能力或时间安排。
3. 知识库没有相关内容时如实说明「知识库未检索到相关内容」，不要追问，也不要臆测。
4. 需要当前日期时调用 get_current_datetime。
5. 最后用不超过 300 字的要点总结与规划相关的事实；没有命中就一句话说明。`

const buildAssessSystem = (
  askRound: number,
): string => `你是规划信息评估节点 assess_plan_info。判断用户给出的规划目标本身是否缺少关键参数，只有在无法据此排期时才追问。
可追问的维度（最多 3 个，问题简短具体）：期望的时间跨度/截止时间、当前基础或起点、每周可投入时间、必须覆盖的重点。
禁止因为「个人知识库没有相关内容」而追问；知识库已有的事实也不要重复询问。
当前追问轮次：${askRound}。若轮次 ≥1，视为信息足够，needMore 必须为 false。
只调用 assess_plan_info 工具。`

const buildDraftSystem = (
  nowMs: number,
  timezone: string,
): string => `你是长期规划制定节点 create_plan_draft。根据目标、知识库事实、用户补充回答和已有规划，输出结构化长期规划草稿。
规则：
1. 知识库中命中的事实必须吸收进目标与阶段（例如已有基础、已报名课程、固定日程）。
2. 知识库未覆盖的部分用通用、可执行的建议补足，不得虚构个人经历、偏好、能力或时间。
3. 阶段 3-8 个，按时间顺序，每阶段给出标题、可执行说明与目标日期（可为 null）。
4. 时间使用毫秒时间戳；当前时间 ${nowMs}，时区 ${timezone}；无法确定结束时间时 endAt 置 null。
5. 标题 ≤30 字；goal 说明期望结果与衡量方式。
只调用 create_plan_draft 工具。`

// ── 图状态 ───────────────────────────────────────────

const PlanState = Annotation.Root({
  goal: Annotation<string>(),
  sessionId: Annotation<string | null>(),
  userId: Annotation<string>(),
  libraryId: Annotation<string>(),
  nowMs: Annotation<number>(),
  timezone: Annotation<string>(),
  draftId: Annotation<string>(),
  researchNotes: Annotation<string>(),
  sources: Annotation<PlanSource[]>(),
  grounded: Annotation<boolean>(),
  existingPlans:
    Annotation<Array<{ id: string; title: string; goal: string; endAt: number | null }>>(),
  questions: Annotation<string[]>(),
  answers: Annotation<string[]>(),
  askRound: Annotation<number>(),
  planDraft: Annotation<PlanDraft | null>(),
  savedPlanId: Annotation<string | null>(),
})

export type PlanGraphState = typeof PlanState.State

export type PlanInvokeKind = 'assess' | 'draft'
/** 测试注入：kind 区分评估/草稿，messages 为完整提示词 */
export type PlanInvoke = (kind: PlanInvokeKind, messages: ChatMessage[]) => Promise<string>

export interface PlanResearchInput {
  goal: string
  libraryId: string
  nowMs: number
  timezone: string
}

export interface PlanResearchOutcome {
  notes: string
  sources: PlanSource[]
}

export interface PlanGraphInput {
  goal: string
  sessionId?: string | null
  userId?: string
  libraryId?: string
  nowMs?: number
  timezone?: string
  /** 测试注入：替换调研 Agent */
  research?: (input: PlanResearchInput) => Promise<PlanResearchOutcome>
  /** 测试注入：替换评估/草稿的模型调用 */
  invoke?: PlanInvoke
}

export type PlanGraphDeps = Pick<PlanGraphInput, 'invoke' | 'research'>

export type PlanResumePayload =
  | { answers: string[] }
  | { action: 'confirm'; draft: PlanDraft }
  | { action: 'discard' }

export type PlanStep = 'ask' | 'confirm' | 'done'

export interface PlanGraphOutcome {
  draftId: string
  threadId: string
  stage: PlanStep
  questions: string[]
  draft: PlanDraft | null
  savedPlan: Plan | null
  done: boolean
}

export class PlanDraftError extends Error {
  constructor(
    message: string,
    public readonly code: 'PLAN_DRAFT_NOT_FOUND' | 'PLAN_RESUME_MISMATCH',
  ) {
    super(message)
    this.name = 'PlanDraftError'
  }
}

// ── 默认模型调用 / 调研实现 ───────────────────────────

const createDefaultInvoke = (): PlanInvoke => async (kind, messages) => {
  const tool = kind === 'assess' ? ASSESS_TOOL : DRAFT_TOOL
  return invokeChatWithTools(
    { temperature: 0.2, feature: 'chat_with_records', tier: 'large' },
    messages,
    [tool],
    { type: 'function', function: { name: tool.function.name } },
  )
}

const dedupeSources = (sources: PlanSource[]): PlanSource[] => {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = `${source.type}:${source.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const defaultResearch = async (input: PlanResearchInput): Promise<PlanResearchOutcome> => {
  const collected: PlanSource[] = []
  const { runToolAgent } = await import('../tools/agent.js')
  const tools = createPlanResearchTools({
    libraryId: input.libraryId,
    now: input.nowMs,
    timezone: input.timezone,
    onSources: (items) => collected.push(...items),
  })

  const outcome = await runToolAgent({
    messages: [
      {
        role: 'user',
        content: `我的规划目标：${input.goal}\n请先检索我的知识库，找出与这个规划相关的个人事实。`,
      },
    ],
    systemPrompt: PLAN_RESEARCH_SYSTEM,
    tools,
    feature: 'chat_with_records',
    tier: 'large',
    maxIterations: 3,
  })

  return {
    notes: outcome.content.trim() || '知识库未检索到相关内容。',
    sources: dedupeSources(collected),
  }
}

// ── 解析与归一化 ─────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const toMs = (value: unknown): number | null => {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  // 秒级时间戳（10 位）自动换算成毫秒
  return value > 0 && value < 1e12 ? Math.round(value * 1000) : Math.round(value)
}

const FALLBACK_STAGES: PlanStage[] = [
  { title: '梳理现状与目标', description: '确认起点、可投入时间与衡量标准。' },
  { title: '分阶段推进核心任务', description: '把目标拆成可执行的小任务，按周推进。' },
  { title: '复盘与调整', description: '定期复盘进度，根据实际情况调整计划。' },
]

const normalizeDraft = (raw: unknown, state: PlanGraphState): PlanDraft => {
  const record = asRecord(raw)
  const title =
    (typeof record?.title === 'string' && record.title.trim().slice(0, 30)) ||
    state.goal.trim().slice(0, 30) ||
    '长期规划'
  const goal = (typeof record?.goal === 'string' && record.goal.trim()) || state.goal.trim()

  const rawStages = Array.isArray(record?.stages) ? record.stages : []
  const stages: PlanStage[] = rawStages
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title.trim() : '',
      description: typeof item.description === 'string' ? item.description.trim() : undefined,
      targetAt: toMs(item.targetAt),
      done: false,
    }))
    .filter((stage) => stage.title.length > 0)
    .slice(0, 8)

  return {
    title,
    goal,
    startAt: toMs(record?.startAt) ?? state.nowMs,
    endAt: toMs(record?.endAt),
    stages: normalizeStages(stages.length > 0 ? stages : FALLBACK_STAGES),
    sources: state.sources,
    grounded: state.grounded,
  }
}

// ── 节点 ─────────────────────────────────────────────

const createResearchNode =
  (options: PlanGraphDeps): GraphNode<PlanGraphState> =>
  async (state) => {
    const existingPlans = await listActivePlanBriefs(state.libraryId)
    let result: PlanResearchOutcome
    try {
      result = options.research
        ? await options.research({
            goal: state.goal,
            libraryId: state.libraryId,
            nowMs: state.nowMs,
            timezone: state.timezone,
          })
        : await defaultResearch({
            goal: state.goal,
            libraryId: state.libraryId,
            nowMs: state.nowMs,
            timezone: state.timezone,
          })
    } catch (error) {
      logger.warn('plan.graph', '知识库调研失败，按通用建议继续', {
        error: (error as Error).message,
      })
      result = { notes: '知识库检索暂时不可用，按通用建议制定规划。', sources: [] }
    }

    const sources = dedupeSources(result.sources)
    logger.info('plan.graph', '调研完成', {
      sourceCount: sources.length,
      notesLength: result.notes.length,
    })
    return {
      researchNotes: result.notes,
      sources,
      grounded: sources.length > 0,
      existingPlans,
    }
  }

const createAssessNode =
  (options: PlanGraphDeps): GraphNode<PlanGraphState> =>
  async (state) => {
    // 已经追问过一轮，不再追问
    if (state.askRound >= 1) return { questions: [] }

    const invoke = options.invoke ?? createDefaultInvoke()
    const messages: ChatMessage[] = [
      { role: 'system', content: buildAssessSystem(state.askRound) },
      {
        role: 'user',
        content: JSON.stringify({
          goal: state.goal,
          knowledgeNotes: state.researchNotes,
          answered: state.answers,
        }),
      },
    ]

    try {
      const parsed = asRecord(parseLooseJson(await invoke('assess', messages)))
      const needMore = parsed?.needMore === true
      const questions = Array.isArray(parsed?.questions)
        ? parsed.questions
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim().slice(0, 200))
            .slice(0, 3)
        : []
      return { questions: needMore ? questions : [] }
    } catch (error) {
      logger.warn('plan.graph', '信息评估失败，直接生成草稿', {
        error: (error as Error).message,
      })
      return { questions: [] }
    }
  }

/** 中断点：把追问交给调用方；resume 时拿回补充回答 */
const askNode: GraphNode<PlanGraphState> = (state) => {
  const resume = interrupt<
    { type: 'plan:questions'; data: { questions: string[]; round: number } },
    PlanResumePayload | undefined
  >({
    type: 'plan:questions',
    data: { questions: state.questions, round: state.askRound },
  })
  if (resume && 'answers' in resume) {
    return { answers: resume.answers, askRound: state.askRound + 1 }
  }
  return {}
}

const createDraftNode =
  (options: PlanGraphDeps): GraphNode<PlanGraphState> =>
  async (state) => {
    const invoke = options.invoke ?? createDefaultInvoke()
    const messages: ChatMessage[] = [
      { role: 'system', content: buildDraftSystem(state.nowMs, state.timezone) },
      {
        role: 'user',
        content: JSON.stringify({
          goal: state.goal,
          knowledgeNotes: state.researchNotes,
          sources: state.sources,
          grounded: state.grounded,
          answers: state.answers,
          existingPlans: state.existingPlans,
        }),
      },
    ]

    try {
      const raw = await invoke('draft', messages)
      return { planDraft: normalizeDraft(parseLooseJson(raw), state) }
    } catch (error) {
      logger.warn('plan.graph', '草稿生成失败，回退为通用草稿', {
        error: (error as Error).message,
      })
      return { planDraft: normalizeDraft(null, state) }
    }
  }

/** 中断点：草稿交给前端编辑确认，或放弃 */
const confirmNode: GraphNode<PlanGraphState> = (state) => {
  const resume = interrupt<
    { type: 'plan:draft'; data: { draft: PlanDraft | null } },
    PlanResumePayload | undefined
  >({
    type: 'plan:draft',
    data: { draft: state.planDraft },
  })
  if (resume && 'action' in resume) {
    if (resume.action === 'discard') return { planDraft: null }
    return { planDraft: resume.draft }
  }
  return {}
}

const saveNode: GraphNode<PlanGraphState> = async (state) => {
  if (!state.planDraft) return {}
  const plan = await insertDraftPlan({
    draft: state.planDraft,
    sessionId: state.sessionId,
    userId: state.userId,
    libraryId: state.libraryId,
    sourceType: 'conversation',
  })
  logger.info('plan.graph', '规划已入库', { planId: plan.id })
  return { savedPlanId: plan.id }
}

const finishNode: GraphNode<PlanGraphState> = () => ({})

// ── 条件边（导出供单测） ─────────────────────────────

export const routeAfterAssess = (
  state: Pick<PlanGraphState, 'questions' | 'askRound'>,
): 'ask' | 'draft' => (state.askRound < 1 && state.questions.length > 0 ? 'ask' : 'draft')

export const routeAfterConfirm = (state: Pick<PlanGraphState, 'planDraft'>): 'save' | 'finish' =>
  state.planDraft ? 'save' : 'finish'

// ── 图构建与编译 ─────────────────────────────────────

export const buildPlanGraph = (options: PlanGraphDeps) =>
  new StateGraph(PlanState)
    .addNode(
      'research',
      tracedNode<PlanGraphState>('plan', 'research', createResearchNode(options)),
    )
    .addNode('assess', tracedNode<PlanGraphState>('plan', 'assess', createAssessNode(options)))
    .addNode('ask', tracedNode<PlanGraphState>('plan', 'ask', askNode))
    .addNode('draft', tracedNode<PlanGraphState>('plan', 'draft', createDraftNode(options)))
    .addNode('confirm', tracedNode<PlanGraphState>('plan', 'confirm', confirmNode))
    .addNode('save', tracedNode<PlanGraphState>('plan', 'save', saveNode))
    .addNode('finish', tracedNode<PlanGraphState>('plan', 'finish', finishNode))
    .addEdge(START, 'research')
    .addEdge('research', 'assess')
    .addConditionalEdges('assess', routeAfterAssess, ['ask', 'draft'])
    .addEdge('ask', 'assess')
    .addEdge('draft', 'confirm')
    .addConditionalEdges('confirm', routeAfterConfirm, ['save', 'finish'])
    .addEdge('save', 'finish')
    .addEdge('finish', END)

type CompiledPlanGraph = Awaited<ReturnType<typeof compileGraph>>

let compiled: Promise<CompiledPlanGraph> | null = null

const getPlanGraph = (options?: PlanGraphDeps): Promise<CompiledPlanGraph> => {
  // 注入测试依赖时单独编译，不影响生产实例复用
  if (options?.invoke || options?.research) {
    return compileGraph(buildPlanGraph(options)) as Promise<CompiledPlanGraph>
  }
  if (!compiled) {
    compiled = (compileGraph(buildPlanGraph({})) as Promise<CompiledPlanGraph>).catch(
      (error: unknown) => {
        compiled = null
        throw error
      },
    )
  }
  return compiled
}

/** 测试用：清空编译缓存（模拟进程重启后重新编译） */
export const resetPlanGraph = (): void => {
  compiled = null
}

// ── 对外入口 ─────────────────────────────────────────

const threadConfig = (threadId: string) => ({ configurable: { thread_id: threadId } })

interface InterruptedResult {
  __interrupt__?: Array<{ value?: { type: string; data: unknown } }>
  savedPlanId?: string | null
}

const toOutcome = async (
  result: InterruptedResult,
  threadId: string,
  draftId: string,
): Promise<PlanGraphOutcome> => {
  if (isInterrupted(result)) {
    const payload = result.__interrupt__?.[0]?.value
    if (payload?.type === 'plan:questions') {
      const data = payload.data as { questions: string[] }
      return {
        draftId,
        threadId,
        stage: 'ask',
        questions: data.questions ?? [],
        draft: null,
        savedPlan: null,
        done: false,
      }
    }
    if (payload?.type === 'plan:draft') {
      const data = payload.data as { draft: PlanDraft | null }
      return {
        draftId,
        threadId,
        stage: 'confirm',
        questions: [],
        draft: data.draft,
        savedPlan: null,
        done: false,
      }
    }
  }

  const savedPlanId = result.savedPlanId ?? null
  return {
    draftId,
    threadId,
    stage: 'done',
    questions: [],
    draft: null,
    savedPlan: savedPlanId ? await getPlan(savedPlanId) : null,
    done: true,
  }
}

/** 启动规划生成：返回追问、草稿或直接入库结果 */
export const runPlanGraph = async (input: PlanGraphInput): Promise<PlanGraphOutcome> => {
  const graph = await getPlanGraph(input)
  const draftId = randomUUID()
  const threadId = planThreadId(draftId)

  const result = (await graph.invoke(
    {
      goal: input.goal.trim(),
      sessionId: input.sessionId ?? null,
      userId: input.userId ?? 'local',
      libraryId: input.libraryId ?? 'default',
      nowMs: input.nowMs ?? Date.now(),
      timezone: input.timezone ?? getLocalTimezone(),
      draftId,
      researchNotes: '',
      sources: [],
      grounded: false,
      existingPlans: [],
      questions: [],
      answers: [],
      askRound: 0,
      planDraft: null,
      savedPlanId: null,
    },
    threadConfig(threadId),
  )) as InterruptedResult

  return toOutcome(result, threadId, draftId)
}

/** 续跑：回答追问、确认/放弃草稿。`options` 仅用于测试注入同一套依赖 */
export const resumePlanGraph = async (
  threadId: string,
  payload: PlanResumePayload,
  options?: PlanGraphDeps,
  libraryId?: string,
): Promise<PlanGraphOutcome> => {
  const ref = parseThreadId(threadId)
  if (!ref || ref.graph !== 'plan') {
    throw new PlanDraftError('无效的规划 thread_id', 'PLAN_DRAFT_NOT_FOUND')
  }

  const graph = await getPlanGraph(options)
  const snapshot = await graph.getState(threadConfig(threadId))
  if (!snapshot.next || snapshot.next.length === 0) {
    throw new PlanDraftError('规划草稿不存在或已完成', 'PLAN_DRAFT_NOT_FOUND')
  }
  const stateValues = snapshot.values as PlanGraphState
  if (libraryId && stateValues.libraryId !== libraryId) {
    throw new PlanDraftError('规划草稿不存在或已完成', 'PLAN_DRAFT_NOT_FOUND')
  }

  const waitingAsk = snapshot.next.includes('ask')
  const waitingConfirm = snapshot.next.includes('confirm')
  if (!waitingAsk && !waitingConfirm) {
    throw new PlanDraftError('规划草稿不存在或已完成', 'PLAN_DRAFT_NOT_FOUND')
  }
  if (waitingAsk && !('answers' in payload)) {
    throw new PlanDraftError('当前需要回答追问', 'PLAN_RESUME_MISMATCH')
  }
  if (waitingConfirm && !('action' in payload)) {
    throw new PlanDraftError('当前需要确认或放弃草稿', 'PLAN_RESUME_MISMATCH')
  }

  const result = (await graph.invoke(
    new Command({ resume: payload }),
    threadConfig(threadId),
  )) as InterruptedResult

  return toOutcome(result, threadId, ref.draftId)
}

/** 读取未完成草稿（刷新恢复用）；已完成或不存在返回 null */
export const readPlanDraft = async (
  threadId: string,
  libraryId?: string,
): Promise<PlanGraphOutcome | null> => {
  const ref = parseThreadId(threadId)
  if (!ref || ref.graph !== 'plan') return null

  const graph = await getPlanGraph()
  const snapshot = await graph.getState(threadConfig(threadId))
  if (!snapshot.next || snapshot.next.length === 0) return null

  const values = snapshot.values as PlanGraphState
  if (libraryId && values.libraryId !== libraryId) return null
  if (snapshot.next.includes('ask')) {
    return {
      draftId: ref.draftId,
      threadId,
      stage: 'ask',
      questions: values.questions ?? [],
      draft: null,
      savedPlan: null,
      done: false,
    }
  }
  if (snapshot.next.includes('confirm')) {
    return {
      draftId: ref.draftId,
      threadId,
      stage: 'confirm',
      questions: [],
      draft: values.planDraft ?? null,
      savedPlan: null,
      done: false,
    }
  }
  return null
}
