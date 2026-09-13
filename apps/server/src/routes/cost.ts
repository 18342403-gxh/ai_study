/**
 * 成本控制查询 API
 *   GET /api/cost/today      — 今日用量速览（total + budget + pct）
 *   GET /api/cost/daily?days=7    — 按天聚合（默认 7 天）
 *   GET /api/cost/breakdown?days=1 — 按 feature + model 拆解
 *   GET /api/cost/settings    — 预算等配置
 */

import { Router } from 'express'
import { getTodayTotal, getDailyStats, getBreakdown } from '../services/costTracker.js'

const router = Router()

/** GET /api/cost/today */
router.get('/today', async (_req, res) => {
  try {
    const today = await getTodayTotal()
    res.json({ ok: true, data: today })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

/** GET /api/cost/daily?days=7 */
router.get('/daily', async (req, res) => {
  try {
    const days = Math.min(30, parseInt((req.query.days as string) || '7', 10))
    const stats = await getDailyStats(days)
    res.json({ ok: true, data: stats })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

/** GET /api/cost/breakdown?days=1 */
router.get('/breakdown', async (req, res) => {
  try {
    const days = Math.min(30, parseInt((req.query.days as string) || '1', 10))
    const breakdown = await getBreakdown(days)
    res.json({ ok: true, data: breakdown })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

/** GET /api/cost/settings */
router.get('/settings', async (_req, res) => {
  res.json({
    ok: true,
    data: {
      dailyTokenBudget: process.env.DAILY_TOKEN_BUDGET || null,
      embeddingMockEnabled: process.env.ENABLE_MOCK_EMBEDDING === '1',
      embeddingFallbackDisabled: process.env.DISABLE_EMBEDDING_FALLBACK === '1',
    },
  })
})

export default router
