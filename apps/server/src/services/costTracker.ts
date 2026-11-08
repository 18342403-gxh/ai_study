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
 *
 * 方言说明：
 *   - 查询/写入全部走 drizzle；唯一感知方言处是 getDailyStats 的日期表达式
 *     （SQLite created_at 是毫秒整数 → date(created_at/1000,'unixepoch')；
 *       PG 是 timestamptz → date(created_at)）
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { desc, gte, sql } from 'drizzle-orm'

import { logger } from './logger.js'
import { getDb, getDriver, tables } from '../db/index.js'
import { estimateCostYuan } from './llm/pricing.js'

/**
 * feature 词表（v5 阶段 11 normalize，与 ai_usage_logs CHECK 约束一致）：
 *   chat_general       通用问答（未注入个人记录）
 *   chat_with_records  带个人记录/资料片段的问答
 *   extract            对话/文档录入抽取
 *   understand         查询理解
 *   embedding          向量化
 *   eval               评测回归
 */
export type AiFeature =
  | 'chat_general'
  | 'chat_with_records'
  | 'extract'
  | 'understand'
  | 'embedding'
  | 'eval'

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
    // 按单价表估算成本（元）；未知模型 → null（pricing 内保守视为付费）
    const cost = estimateCostYuan(
      info.provider || 'zhipu',
      info.model,
      info.promptTokens,
      info.completionTokens,
    )
    await db.insert(tables.aiUsageLogs).values({
      id: randomUUID(),
      feature: info.feature,
      model: info.model,
      provider: info.provider || 'zhipu',
      promptTokens: info.promptTokens,
      completionTokens: info.completionTokens,
      totalTokens: info.totalTokens,
      costMs: info.costMs || 0,
      cost,
      userId: info.userId || null,
      sessionId: info.sessionId || null,
      metadata: info.metadata ?? null,
      createdAt: new Date(),
    })

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
    // 当日 00:00（本地时区）
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const rows = await db
      .select({
        total: sql<number>`COALESCE(SUM(${tables.aiUsageLogs.totalTokens}), 0)`,
      })
      .from(tables.aiUsageLogs)
      .where(gte(tables.aiUsageLogs.createdAt, startOfDay))

    const dailyTotal = Number(rows[0]?.total || 0)
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
  /** 按单价表估算的金额（元），未知模型不计入 */
  totalCostYuan: number
}

export async function getDailyStats(days = 7): Promise<DailyAggregate[]> {
  const db = getDb()
  const driver = getDriver()

  // SQLite: created_at = INTEGER ms timestamp → date(created_at/1000,'unixepoch')
  // PG:     created_at = TIMESTAMPTZ          → date(created_at)
  const dateExpr =
    driver === 'sqlite'
      ? sql`date(${tables.aiUsageLogs.createdAt} / 1000, 'unixepoch')`
      : sql`date(${tables.aiUsageLogs.createdAt})`

  const rows = await db
    .select({
      date: sql<string>`${dateExpr}`,
      totalTokens: sql<number>`SUM(${tables.aiUsageLogs.totalTokens})`,
      chatTokens: sql<number>`SUM(CASE WHEN ${tables.aiUsageLogs.feature} IN ('chat_general','chat_with_records') THEN ${tables.aiUsageLogs.totalTokens} ELSE 0 END)`,
      generatorTokens: sql<number>`0`,
      embeddingTokens: sql<number>`SUM(CASE WHEN ${tables.aiUsageLogs.feature} = 'embedding' THEN ${tables.aiUsageLogs.totalTokens} ELSE 0 END)`,
      callCount: sql<number>`COUNT(*)`,
      totalCostMs: sql<number>`SUM(${tables.aiUsageLogs.costMs})`,
      totalCostYuan: sql<number>`COALESCE(SUM(${tables.aiUsageLogs.cost}), 0)`,
    })
    .from(tables.aiUsageLogs)
    .where(gte(tables.aiUsageLogs.createdAt, new Date(Date.now() - days * 86_400_000)))
    .groupBy(dateExpr)
    .orderBy(desc(dateExpr))
    .limit(days)

  return rows.map((r) => ({
    date: String(r.date),
    totalTokens: Number(r.totalTokens || 0),
    chatTokens: Number(r.chatTokens || 0),
    generatorTokens: 0,
    embeddingTokens: Number(r.embeddingTokens || 0),
    callCount: Number(r.callCount || 0),
    totalCostMs: Number(r.totalCostMs || 0),
    totalCostYuan: Number(r.totalCostYuan || 0),
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
    .select({
      feature: tables.aiUsageLogs.feature,
      model: tables.aiUsageLogs.model,
      totalTokens: sql<number>`SUM(${tables.aiUsageLogs.totalTokens})`,
      promptTokens: sql<number>`SUM(${tables.aiUsageLogs.promptTokens})`,
      completionTokens: sql<number>`SUM(${tables.aiUsageLogs.completionTokens})`,
      callCount: sql<number>`COUNT(*)`,
    })
    .from(tables.aiUsageLogs)
    .where(gte(tables.aiUsageLogs.createdAt, new Date(Date.now() - days * 86_400_000)))
    .groupBy(tables.aiUsageLogs.feature, tables.aiUsageLogs.model)
    .orderBy(desc(sql`SUM(${tables.aiUsageLogs.totalTokens})`))

  return rows.map((r) => ({
    feature: r.feature as AiFeature,
    model: String(r.model),
    totalTokens: Number(r.totalTokens || 0),
    promptTokens: Number(r.promptTokens || 0),
    completionTokens: Number(r.completionTokens || 0),
    callCount: Number(r.callCount || 0),
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

  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${tables.aiUsageLogs.totalTokens}), 0)`,
      calls: sql<number>`COUNT(*)`,
    })
    .from(tables.aiUsageLogs)
    .where(gte(tables.aiUsageLogs.createdAt, startOfDay))

  const budgetStr = process.env.DAILY_TOKEN_BUDGET
  const budget = budgetStr ? parseInt(budgetStr, 10) : null
  const total = Number(rows[0]?.total || 0)
  return {
    totalTokens: total,
    callCount: Number(rows[0]?.calls || 0),
    budget,
    pct: budget ? Math.round((total / budget) * 100) : null,
  }
}

// ── 月度金额预算（spec 10.4：单价表 × 用量 → 熔断依据） ────

export interface MonthCost {
  /** 本月累计估算花费（元） */
  costYuan: number
  /** 月度预算（元），默认 10；MONTHLY_COST_BUDGET 可配 */
  budgetYuan: number
  pct: number
  /** ≥100% → 付费模型强制降级到免费档 */
  blocked: boolean
  /** ≥80% → 界面警告 */
  warning: boolean
}

export const getMonthlyBudgetYuan = (): number => {
  const parsed = parseFloat(process.env.MONTHLY_COST_BUDGET ?? '')
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
}

export async function getMonthCost(): Promise<MonthCost> {
  const db = getDb()
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${tables.aiUsageLogs.cost}), 0)`,
    })
    .from(tables.aiUsageLogs)
    .where(gte(tables.aiUsageLogs.createdAt, monthStart))

  const costYuan = Number(rows[0]?.total || 0)
  const budgetYuan = getMonthlyBudgetYuan()
  const pct = budgetYuan > 0 ? (costYuan / budgetYuan) * 100 : 0
  return { costYuan, budgetYuan, pct, blocked: pct >= 100, warning: pct >= 80 }
}

// 熔断检查走缓存：同一个月份窗口内 60s 查一次库，避免每次调用都 COUNT
const MONTH_CHECK_INTERVAL_MS = 60_000
let monthCache: { value: MonthCost; at: number } | null = null

export async function checkMonthlyBudget(): Promise<MonthCost> {
  const now = Date.now()
  if (monthCache && now - monthCache.at < MONTH_CHECK_INTERVAL_MS) return monthCache.value
  try {
    const value = await getMonthCost()
    monthCache = { value, at: now }
    return value
  } catch (err) {
    // 查询失败不阻断调用（记账是异步旁路）
    logger.debug('cost-tracker', '月度预算检查跳过', { error: (err as Error).message })
    return {
      costYuan: 0,
      budgetYuan: getMonthlyBudgetYuan(),
      pct: 0,
      blocked: false,
      warning: false,
    }
  }
}

/** 测试用：清除月度预算缓存 */
export const resetMonthBudgetCache = (): void => {
  monthCache = null
}
