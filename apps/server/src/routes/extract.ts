/**
 * 信息抽取 API — v5 阶段 4
 *
 * POST /api/extract — 对话文本 → 意图判别 + 结构化条目（含重复/冲突提示）
 *
 * 约定：
 *   - 本接口只做抽取与提示，不写库；用户确认后走 POST /api/entries
 *   - 时间统一返回毫秒时间戳，并附带可直接展示的绝对时间文本
 *   - 失败时仍返回 200，ok=false + failed 标记，保留原文供手动新建
 */

import { Router } from 'express'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'

import { getDb, tables } from '../db/index.js'
import { asyncHandler, validate } from '../middleware/index.js'
import { logger } from '../services/logger.js'
import { extractEntries, type PromptEntry } from '../services/extract/extractor.js'
import { buildDedupeInfo, type ExistingEntry } from '../services/extract/dedupe.js'
import type { Recurrence } from '../services/extract/recurrence.js'
import {
  formatDateTime,
  formatRecurrenceText,
  getLocalTimezone,
} from '../services/extract/timeParse.js'

const router = Router()

const extractSchema = z.object({
  text: z.string().trim().min(1, '文本不能为空').max(5000, '单次文本不能超过 5000 字'),
  sessionId: z.string().max(64).nullable().optional(),
  libraryId: z.string().max(64).default('default'),
})

type EntryRow = typeof tables.entries.$inferSelect

const toRecurrence = (value: unknown): Recurrence | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const freq = (value as Record<string, unknown>).freq
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null
  return value as Recurrence
}

const rowToExisting = (row: EntryRow): ExistingEntry => ({
  id: row.id,
  type: row.type,
  title: row.title,
  content: row.content,
  startAt: row.startAt ? row.startAt.getTime() : null,
  endAt: row.endAt ? row.endAt.getTime() : null,
  recurrence: toRecurrence(row.recurrence),
  recurrenceUntil: row.recurrenceUntil ? row.recurrenceUntil.getTime() : null,
})

const rowTimeText = (row: EntryRow): string | undefined => {
  const recurrence = toRecurrence(row.recurrence)
  if (recurrence && row.startAt) return formatRecurrenceText(recurrence, row.startAt.getTime())
  return row.startAt ? formatDateTime(row.startAt.getTime()) : undefined
}

/** 字符二元组相似度 — 用于挑出最相关的已有记录（避免为 Prompt 额外调用 embedding） */
const bigramSimilarity = (a: string, b: string): number => {
  const grams = (text: string) => {
    const clean = text.replace(/\s+/g, '').toLowerCase()
    const set = new Set<string>()
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2))
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let shared = 0
  for (const gram of ga) if (gb.has(gram)) shared++
  return shared / Math.max(ga.size, gb.size)
}

/** 最相似的 5 条已有记录（注入 Prompt） */
const pickRelated = (text: string, rows: EntryRow[]): EntryRow[] => {
  if (rows.length <= 5) return rows
  return [...rows]
    .map((row) => ({
      row,
      score: bigramSimilarity(text, `${row.title}${row.content}`),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.row)
}

/** POST /api/extract — 抽取 */
router.post(
  '/',
  validate({ body: extractSchema }),
  asyncHandler(async (req, res) => {
    const body = extractSchema.parse(req.body)
    const nowMs = Date.now()
    const timezone = getLocalTimezone()

    const db = getDb()
    // 判重与 Prompt 参考都只看当前知识库的 active 条目
    const rows = await db
      .select()
      .from(tables.entries)
      .where(and(eq(tables.entries.libraryId, body.libraryId), eq(tables.entries.status, 'active')))
      .orderBy(desc(tables.entries.updatedAt))
      .limit(50)

    const related = pickRelated(body.text, rows)
    const promptEntries: PromptEntry[] = related.map((row) => ({
      type: row.type,
      title: row.title,
      content: row.content,
      timeText: rowTimeText(row),
    }))

    const outcome = await extractEntries({
      text: body.text,
      now: nowMs,
      timezone,
      existingEntries: promptEntries,
    })

    const existing = rows.map(rowToExisting)
    const dedupe = await Promise.all(
      outcome.entries.map((entry) => buildDedupeInfo(entry, existing, nowMs)),
    )

    const entries = outcome.entries.map((entry, index) => {
      const info = dedupe[index]
      return {
        ...entry,
        duplicate: info.duplicate,
        conflicts: info.conflicts.map((conflict) => ({
          ...conflict,
          startText: formatDateTime(conflict.start, timezone),
          endText: conflict.end !== null ? formatDateTime(conflict.end, timezone) : null,
        })),
      }
    })

    logger.info('extract.route', 'POST / 完成', {
      libraryId: body.libraryId,
      intent: outcome.intent,
      entryCount: entries.length,
      failed: outcome.failed,
    })

    res.json({
      ...outcome,
      entries,
      source: {
        sessionId: body.sessionId ?? null,
        libraryId: body.libraryId,
      },
    })
  }),
)

export default router
