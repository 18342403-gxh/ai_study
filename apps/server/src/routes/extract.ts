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
import { randomUUID } from 'crypto'

import { getDb, tables } from '../db/index.js'
import { asyncHandler, validate } from '../middleware/index.js'
import { logger } from '../services/logger.js'
import { extractEntries, type PromptEntry } from '../services/extract/extractor.js'
import {
  buildEntryCards,
  pickRelated,
  rowTimeText,
  rowToExisting,
} from '../services/extract/cards.js'
import { getLocalTimezone } from '../services/extract/timeParse.js'

const router = Router()

const extractSchema = z.object({
  text: z.string().trim().min(1, '文本不能为空').max(5000, '单次文本不能超过 5000 字'),
  sessionId: z.string().max(64).nullable().optional(),
  libraryId: z.string().max(64).default('default'),
})

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
    const entries = await buildEntryCards(outcome.entries, existing, nowMs, timezone)

    // ── 抽取失败时把原文落库为 draft 草稿，避免用户输入丢失 ──
    let draftEntryId: string | null = null
    if (outcome.failed !== null) {
      draftEntryId = randomUUID()
      const draftTitle = body.text.slice(0, 30).trim() || '抽取失败草稿'
      try {
        await db.insert(tables.entries).values({
          id: draftEntryId,
          userId: 'local',
          libraryId: body.libraryId,
          type: 'note',
          title: draftTitle,
          content: body.text,
          status: 'draft',
          startAt: null,
          endAt: null,
          recurrence: null,
          recurrenceUntil: null,
          exceptions: null,
          sourceType: 'conversation',
          sourceRef: body.sessionId ?? null,
          confidence: 0,
          createdAt: new Date(nowMs),
          updatedAt: new Date(nowMs),
          archivedAt: null,
        })
        logger.info('extract.route', '抽取失败，原文已落库为 draft 草稿', {
          draftEntryId,
          libraryId: body.libraryId,
          failed: outcome.failed,
        })
      } catch (dbErr) {
        logger.error('extract.route', 'draft 草稿落库失败（不影响响应）', {
          error: (dbErr as Error).message,
        })
        draftEntryId = null
      }
    }

    logger.info('extract.route', 'POST / 完成', {
      libraryId: body.libraryId,
      intent: outcome.intent,
      entryCount: entries.length,
      failed: outcome.failed,
      draftEntryId,
    })

    res.json({
      ...outcome,
      entries,
      draftEntryId,
      source: {
        sessionId: body.sessionId ?? null,
        libraryId: body.libraryId,
      },
    })
  }),
)

export default router
