/**
 * Cost Tracker — AI 调用用量追踪 + 预算告警
 *
 * 架构：
 *   model.ts / embedding.ts 调用完 AI → emit('usage', usageInfo)
 *   这里监听事件 → 异步入库（不阻塞主流程）
 *   每日预算超阈值 → emit('budget_warning')
 *
 * 设计原则：
 *   - 非阻塞：用量写入是异步的，不影响 AI 调用速度
 *   - 容错：写入失败只 warn 不 throw，主流程不受影响
 *   - 统一入口：所有 AI 相关调用都走这里记录
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { logger } from './logger.js'
import { getDb, getDriver } from '../db/index.js'

export type AiFeature = 'chat' | 'generator' | 'rag' | 'embedding' | 'eval'

export interface UsageInfo {
  feature: AiFeature
  model: string
  provider?: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costMs?: number
  userId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
}

class CostTrackerEmitter extends EventEmitter {
  /** 记录一次 AI 调用用量（异步入库，不阻塞） */
  track(info: UsageInfo): void {
    this.emit('usage', info)
  }

  /** 预算告警 */
  onBudgetWarning(cb: (data: BudgetWarning) => void) {
    this.on('budget_warning', cb)
  }
}

export interface BudgetWarning {
  dailyTotalTokens: number
  dailyBudgetTokens: number
  usagePct: number
  at: Date
}

export const costTracker = new CostTrackerEmitter()

// ── 异步入库（监听事件） ──────────────────────────────────

costTracker.on('usage', async (info: UsageInfo) => {
  try {
    const db = getDb()
    const id = randomUUID()
    const createdAt = Date.now() // SQLite 用 INTEGER timestamp
    await db
      .prepare(
        `
      INSERT INTO ai_usage_logs (
        id, feature, model, provider,
        prompt_tokens, completion_tokens, total_tokens,
        cost_ms, user_id, session_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        info.feature,
        info.model,
        info.provider || 'zhipu',
        info.promptTokens,
        info.completionTokens,
        info.totalTokens,
        info.costMs || 0,
        info.userId || null,
        info.sessionId || null,
        info.metadata ? JSON.stringify(info.metadata) : null,
        createdAt,
      )

    // ── 预算检查（每次用完都检查一次当日累计） ──────────
    checkDailyBudget(info)
  } catch (err) {
    // 写入失败不影响主流程
    logger.warn('cost-tracker', '用量记录失败（不影响主流程）', {
      error: (err as Error).message,
      feature: info.feature,
      model: info.model,
    })
  }
})

// ── 预算检查 ──────────────────────────────────────────────

const BUDGET_CHECK_INTERVAL_MS = 60_000 // 同一分钟内只查一次
let lastBudgetCheck = 0

async function checkDailyBudget(info: UsageInfo): Promise<void> {
  const budgetStr = process.env.DAILY_TOKEN_BUDGET
  if (!budgetStr) return // 未配置预算则不检查

  const now = Date.now()
  if (now - lastBudgetCheck < BUDGET_CHECK_INTERVAL_MS) return // 频率限制
  lastBudgetCheck = now

  const dailyBudget = parseInt(budgetStr, 10)
  try {
    const db = getDb()
    // 当日 00:00 的毫秒时间戳（本地时区）
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const dayStart = startOfDay.getTime()

    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(total_tokens), 0) as total FROM ai_usage_logs WHERE created_at >= ?`,
      )
      .get<{ total: number }>(dayStart)

    const dailyTotal = Number(row?.total || 0)
    if (dailyTotal >= dailyBudget) {
      const pct = Math.min(100, Math.round((dailyTotal / dailyBudget) * 100))
      logger.error('cost-tracker', `⚠️  日 Token 预算已达 ${pct}%`, {
        dailyTotal,
        dailyBudget,
        pct,
      })
      costTracker.emit('budget_warning', {
        dailyTotalTokens: dailyTotal,
        dailyBudgetTokens: dailyBudget,
        usagePct: pct,
        at: new Date(),
      })
    } else if (dailyTotal >= dailyBudget * 0.8) {
      const pct = Math.round((dailyTotal / dailyBudget) * 100)
      logger.warn('cost-tracker', `日 Token 预算已用 ${pct}%（接近阈值）`, {
        dailyTotal,
        dailyBudget,
        pct,
      })
    }
  } catch (err) {
    logger.debug('cost-tracker', '预算检查跳过', { error: (err as Error).message })
  }
}

// ── 查询 API（给 routes/cost.ts 用） ──────────────────────

export interface DailyAggregate {
  date: string
  totalTokens: number
  chatTokens: number
  generatorTokens: number
  embeddingTokens: number
  callCount: number
  totalCostMs: number
}

export async function getDailyStats(days = 7): Promise<DailyAggregate[]> {
  const db = getDb()
  const driver = getDriver()

  // SQLite: created_at = INTEGER ms timestamp
  // PG:     created_at = TIMESTAMPTZ
  const dateExpr = driver === 'sqlite' ? `DATE(created_at / 1000, 'unixepoch')` : `DATE(created_at)`

  const rows = await db
    .prepare(
      `
    SELECT
      ${dateExpr} as date,
      SUM(total_tokens) as total_tokens,
      SUM(CASE WHEN feature = 'chat' THEN total_tokens ELSE 0 END) as chat_tokens,
      SUM(CASE WHEN feature = 'generator' THEN total_tokens ELSE 0 END) as generator_tokens,
      SUM(CASE WHEN feature = 'embedding' THEN total_tokens ELSE 0 END) as embedding_tokens,
      COUNT(*) as call_count,
      SUM(cost_ms) as total_cost_ms
    FROM ai_usage_logs
    WHERE created_at >= ?
    GROUP BY ${dateExpr}
    ORDER BY date DESC
    LIMIT ?
  `,
    )
    .all<Record<string, unknown>>(Date.now() - days * 86_400_000, days)
  return rows.map((r) => ({
    date: String(r.date),
    totalTokens: Number(r.total_tokens || 0),
    chatTokens: Number(r.chat_tokens || 0),
    generatorTokens: Number(r.generator_tokens || 0),
    embeddingTokens: Number(r.embedding_tokens || 0),
    callCount: Number(r.call_count || 0),
    totalCostMs: Number(r.total_cost_ms || 0),
  }))
}

export interface BreakdownItem {
  feature: AiFeature
  model: string
  totalTokens: number
  promptTokens: number
  completionTokens: number
  callCount: number
}

export async function getBreakdown(days = 1): Promise<BreakdownItem[]> {
  const db = getDb()
  const rows = await db
    .prepare(
      `
    SELECT feature, model,
      SUM(total_tokens) as total_tokens,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      COUNT(*) as call_count
    FROM ai_usage_logs
    WHERE created_at >= ?
    GROUP BY feature, model
    ORDER BY total_tokens DESC
  `,
    )
    .all<Record<string, unknown>>(Date.now() - days * 86_400_000)
  return rows.map((r) => ({
    feature: r.feature as AiFeature,
    model: String(r.model),
    totalTokens: Number(r.total_tokens || 0),
    promptTokens: Number(r.prompt_tokens || 0),
    completionTokens: Number(r.completion_tokens || 0),
    callCount: Number(r.call_count || 0),
  }))
}

export async function getTodayTotal(): Promise<{
  totalTokens: number
  callCount: number
  budget: number | null
  pct: number | null
}> {
  const db = getDb()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const dayStart = startOfDay.getTime()

  const row = await db
    .prepare(
      `
    SELECT COALESCE(SUM(total_tokens), 0) as total, COUNT(*) as calls
    FROM ai_usage_logs WHERE created_at >= ?
  `,
    )
    .get<{ total: number; calls: number }>(dayStart)

  const budgetStr = process.env.DAILY_TOKEN_BUDGET
  const budget = budgetStr ? parseInt(budgetStr, 10) : null
  const total = Number(row?.total || 0)
  return {
    totalTokens: total,
    callCount: Number(row?.calls || 0),
    budget,
    pct: budget ? Math.round((total / budget) * 100) : null,
  }
}
