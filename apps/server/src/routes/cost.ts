/**
 * 成本控制查询 API
 *   GET /api/cost/today      — 今日用量速览（total + budget + pct）
 *   GET /api/cost/daily?days=7    — 按天聚合（默认 7 天）
 *   GET /api/cost/breakdown?days=1 — 按 feature + model 拆解
 *   GET /api/cost/settings    — 预算等配置
 */

import { Router } from 'express'
import { z } from 'zod'
import { getTodayTotal, getDailyStats, getBreakdown } from '../services/costTracker.js'
import { validate, asyncHandler } from '../middleware/index.js'

const router = Router()

const daysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).optional(),
})

/** GET /api/cost/today */
router.get(
  '/today',
  asyncHandler(async (_req, res) => {
    const today = await getTodayTotal()
    res.json({ ok: true, data: today })
  }),
)

/** GET /api/cost/daily?days=7 */
router.get(
  '/daily',
  validate({ query: daysQuerySchema }),
  asyncHandler(async (req, res) => {
    const { days } = daysQuerySchema.parse(req.query)
    const stats = await getDailyStats(days ?? 7)
    res.json({ ok: true, data: stats })
  }),
)

/** GET /api/cost/breakdown?days=1 */
router.get(
  '/breakdown',
  validate({ query: daysQuerySchema }),
  asyncHandler(async (req, res) => {
    const { days } = daysQuerySchema.parse(req.query)
    const breakdown = await getBreakdown(days ?? 1)
    res.json({ ok: true, data: breakdown })
  }),
)

/** GET /api/cost/settings */
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      data: {
        dailyTokenBudget: process.env.DAILY_TOKEN_BUDGET || null,
        embeddingMockEnabled: process.env.ENABLE_MOCK_EMBEDDING === '1',
        embeddingFallbackDisabled: process.env.DISABLE_EMBEDDING_FALLBACK === '1',
      },
    })
  }),
)

export default router
