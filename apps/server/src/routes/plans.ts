/**
 * 长期规划 API
 *
 * GET    /api/plans                 — 列表（?status=&libraryId=&limit=）
 * POST   /api/plans                 — 手动新建 / 旧 plan 条目转换（fromEntryId）
 * GET    /api/plans/capabilities    — AI 生成能力开关
 * POST   /api/plans/generate        — 启动 AI 规划生成（检索 + 追问 + 草稿）
 * GET    /api/plans/drafts/:threadId        — 读取未完成草稿（刷新恢复）
 * POST   /api/plans/drafts/:threadId/resume — 回答追问 / 确认草稿 / 放弃
 * PATCH  /api/plans/:id             — 更新
 * DELETE /api/plans/:id             — 删除
 *
 * 约定：出入参 camelCase，时间为毫秒时间戳；AI 能力用 ENABLE_PLAN_AI 关闭。
 */

import { Router } from 'express'
import { z } from 'zod'

import { validate, asyncHandler, createError, requireUser } from '../middleware/index.js'
import { logger } from '../services/logger.js'
import {
  convertEntryToPlan,
  createPlan,
  deletePlan,
  listPlans,
  updatePlan,
  type PlanDraft,
  type PlanStage,
  type PlanStatus,
} from '../services/plans/store.js'
import {
  PlanDraftError,
  readPlanDraft,
  resumePlanGraph,
  runPlanGraph,
  type PlanResumePayload,
} from '../services/plan/graph.js'

const router = Router()

const planStatusEnum = z.enum(['draft', 'active', 'done', 'archived'])

const stageSchema = z.object({
  id: z.string().max(64).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  targetAt: z.number().int().nullable().optional(),
  done: z.boolean().optional(),
})

const sourceSchema = z.object({
  type: z.enum(['entry', 'chunk']),
  id: z.string().max(128),
  label: z.string().max(512),
  snippet: z.string().max(2000),
})

const draftSchema = z.object({
  title: z.string().min(1).max(100),
  goal: z.string().max(5000),
  startAt: z.number().int().nullable(),
  endAt: z.number().int().nullable(),
  stages: z.array(stageSchema).max(20),
  sources: z.array(sourceSchema).max(20),
  grounded: z.boolean(),
})

const timeRule = (
  data: { startAt?: number | null; endAt?: number | null },
  ctx: z.RefinementCtx,
) => {
  if (
    data.startAt !== undefined &&
    data.startAt !== null &&
    data.endAt !== undefined &&
    data.endAt !== null &&
    data.endAt < data.startAt
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endAt'],
      message: 'endAt 不能早于 startAt',
    })
  }
}

const createPlanSchema = z
  .object({
    title: z.string().min(1, '标题不能为空').max(100).optional(),
    goal: z.string().max(5000).default(''),
    status: planStatusEnum.default('active'),
    startAt: z.number().int().nullable().optional(),
    endAt: z.number().int().nullable().optional(),
    progress: z.number().int().min(0).max(100).default(0),
    stages: z.array(stageSchema).max(20).default([]),
    libraryId: z.string().max(64).default('default'),
    /** 从旧的 type=plan 条目转换 */
    fromEntryId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.fromEntryId && !data.title) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: '标题不能为空' })
    }
    timeRule(data, ctx)
  })

const updatePlanSchema = z
  .object({
    title: z.string().min(1).max(100).optional(),
    goal: z.string().max(5000).optional(),
    status: planStatusEnum.optional(),
    startAt: z.number().int().nullable().optional(),
    endAt: z.number().int().nullable().optional(),
    progress: z.number().int().min(0).max(100).optional(),
    stages: z.array(stageSchema).max(20).optional(),
    libraryId: z.string().max(64).optional(),
  })
  .superRefine(timeRule)

const listQuerySchema = z.object({
  status: planStatusEnum.optional(),
  libraryId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

const idParam = z.object({ id: z.string().min(1) })
const threadParam = z.object({ threadId: z.string().min(1).max(160) })

const generateSchema = z.object({
  goal: z.string().min(2, '请描述你的规划目标').max(1000),
  sessionId: z.string().max(64).optional(),
  libraryId: z.string().max(64).default('default'),
})

const resumeSchema = z.union([
  z.object({ answers: z.array(z.string().min(1).max(2000)).min(1).max(3) }),
  z.object({ action: z.literal('confirm'), draft: draftSchema }),
  z.object({ action: z.literal('discard') }),
])

const aiEnabled = () => process.env.ENABLE_PLAN_AI !== '0'

const toStepResponse = (result: Awaited<ReturnType<typeof runPlanGraph>>) => ({
  ok: true as const,
  threadId: result.threadId,
  draftId: result.draftId,
  stage: result.stage,
  questions: result.questions,
  draft: result.draft,
  savedPlan: result.savedPlan,
  done: result.done,
})

// ── 列表 / 能力 ─────────────────────────────────────

router.get(
  '/capabilities',
  asyncHandler(async (_req, res) => {
    res.json({ aiEnabled: aiEnabled() })
  }),
)

router.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const query = listQuerySchema.parse(req.query)
    const plans = await listPlans({
      status: query.status as PlanStatus | undefined,
      libraryId: user.libraryId,
      limit: query.limit,
    })
    res.json(plans)
  }),
)

// ── AI 生成草稿 ─────────────────────────────────────

router.post(
  '/generate',
  validate({ body: generateSchema }),
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      throw createError('AI 规划生成已关闭', 409, 'PLAN_AI_DISABLED')
    }
    const body = generateSchema.parse(req.body)
    const user = requireUser(req)
    logger.info('plans.route', 'POST /generate — 开始', { goalLength: body.goal.length })
    const result = await runPlanGraph({
      goal: body.goal,
      sessionId: body.sessionId,
      userId: user.id,
      libraryId: user.libraryId,
    })
    res.status(201).json(toStepResponse(result))
  }),
)

router.get(
  '/drafts/:threadId',
  validate({ params: threadParam }),
  asyncHandler(async (req, res) => {
    const result = await readPlanDraft(req.params.threadId, requireUser(req).libraryId)
    if (!result) throw createError('规划草稿不存在或已完成', 404, 'PLAN_DRAFT_NOT_FOUND')
    res.json(toStepResponse(result))
  }),
)

router.post(
  '/drafts/:threadId/resume',
  validate({ params: threadParam, body: resumeSchema }),
  asyncHandler(async (req, res) => {
    const body = resumeSchema.parse(req.body)
    const user = requireUser(req)
    const threadId = req.params.threadId
    try {
      const result = await resumePlanGraph(
        threadId,
        body as PlanResumePayload,
        undefined,
        user.libraryId,
      )
      res.json(toStepResponse(result))
    } catch (error) {
      if (error instanceof PlanDraftError) {
        const status = error.code === 'PLAN_DRAFT_NOT_FOUND' ? 404 : 400
        throw createError(error.message, status, error.code)
      }
      throw error
    }
  }),
)

// ── 增删改 ──────────────────────────────────────────

router.post(
  '/',
  validate({ body: createPlanSchema }),
  asyncHandler(async (req, res) => {
    const body = createPlanSchema.parse(req.body)
    const user = requireUser(req)

    if (body.fromEntryId) {
      const converted = await convertEntryToPlan(body.fromEntryId, {
        userId: user.id,
        libraryId: user.libraryId,
      })
      if (!converted.ok) {
        const code = converted.reason === 'ENTRY_NOT_FOUND' ? 'ENTRY_NOT_FOUND' : 'ENTRY_NOT_PLAN'
        throw createError(
          converted.reason === 'ENTRY_NOT_FOUND' ? '条目不存在' : '只有 plan 类型条目可以转换',
          converted.reason === 'ENTRY_NOT_FOUND' ? 404 : 400,
          code,
        )
      }
      res.status(converted.alreadyConverted ? 200 : 201).json(converted.plan)
      return
    }

    const plan = await createPlan({
      title: body.title as string,
      goal: body.goal,
      status: body.status as PlanStatus,
      startAt: body.startAt,
      endAt: body.endAt,
      progress: body.progress,
      stages: body.stages as PlanStage[],
      userId: user.id,
      libraryId: user.libraryId,
      sourceType: 'manual',
    })
    logger.info('plans.route', 'POST / 完成', { planId: plan.id })
    res.status(201).json(plan)
  }),
)

router.patch(
  '/:id',
  validate({ params: idParam, body: updatePlanSchema }),
  asyncHandler(async (req, res) => {
    const body = updatePlanSchema.parse(req.body)
    const user = requireUser(req)
    const existing = await updatePlan(
      req.params.id,
      {
        title: body.title,
        goal: body.goal,
        status: body.status as PlanStatus | undefined,
        startAt: body.startAt,
        endAt: body.endAt,
        progress: body.progress,
        stages: body.stages as PlanStage[] | undefined,
      },
      user.libraryId,
    )
    if (!existing) throw createError('规划不存在', 404, 'PLAN_NOT_FOUND')
    res.json(existing)
  }),
)

router.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const removed = await deletePlan(req.params.id, requireUser(req).libraryId)
    if (!removed) throw createError('规划不存在', 404, 'PLAN_NOT_FOUND')
    res.status(204).end()
  }),
)

export default router

export type { PlanDraft }
