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
import { removeEntryEmbedding, syncEntryEmbedding } from '../services/search/entryIndex.js'

// ── 取消/删除：把抽取到的「目标条目」匹配到已有记录 ──

type EntryRow = typeof tables.entries.$inferSelect

/** 提取用于匹配的关键词（去标点，按单字+中文词切分） */
const keywords = (text: string): string[] =>
  text
    .replace(/[\s，。、,.!?！？；;:："'""''（）()【】[\]《》<>]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** 标题相似度：关键词交集占比 + 单字 Jaccard */
const titleSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0
  if (a === b) return 1
  const ka = keywords(a)
  const kb = keywords(b)
  const setA = new Set(ka)
  const setB = new Set(kb)
  const inter = [...setA].filter((k) => setB.has(k)).length
  const union = new Set([...setA, ...setB]).size
  const kwScore = union === 0 ? 0 : inter / union
  // 单字级别再算一次，补全中文短词匹配
  const ca = new Set(a.split(''))
  const cb = new Set(b.split(''))
  const cInter = [...ca].filter((c) => cb.has(c)).length
  const cUnion = new Set([...ca, ...cb]).size
  const charScore = cUnion === 0 ? 0 : cInter / cUnion
  return Math.max(kwScore, charScore * 0.8)
}

/** 时间段是否重叠（含相邻）；任一方无时间则跳过时间判定 */
const timeOverlap = (
  aStart: number | null,
  aEnd: number | null,
  bStart: number | null,
  bEnd: number | null,
): number => {
  if (!aStart || !bStart) return 0
  const aE = aEnd ?? aStart
  const bE = bEnd ?? bStart
  const overlap = Math.max(0, Math.min(aE, bE) - Math.max(aStart, bStart))
  const span = Math.max(1, Math.max(aE, bE) - Math.min(aStart, bStart))
  return overlap / span
}

type ExtractedTarget = Awaited<ReturnType<typeof extractEntries>>['entries'][number]

interface MatchedTarget {
  id: string
  /** 命中的抽取目标（update 时从中取新时间） */
  target: ExtractedTarget
}

/** 从已有记录里为每个抽取目标找最佳匹配，返回 { id, target } 映射 */
const matchExistingEntries = (
  targets: Awaited<ReturnType<typeof extractEntries>>['entries'],
  rows: EntryRow[],
): MatchedTarget[] => {
  const matched = new Map<string, ExtractedTarget>()
  for (const target of targets) {
    let bestId: string | null = null
    let bestScore = 0
    for (const row of rows) {
      if (matched.has(row.id)) continue
      const ts =
        titleSimilarity(target.title, row.title) || titleSimilarity(target.title, row.content)
      const timeScore = timeOverlap(
        target.time?.start ?? null,
        target.time?.end ?? null,
        row.startAt ? row.startAt.getTime() : null,
        row.endAt ? row.endAt.getTime() : null,
      )
      const typeBonus = target.type === row.type ? 0.1 : 0
      const score = ts * 0.6 + timeScore * 0.3 + typeBonus
      if (score > bestScore) {
        bestScore = score
        bestId = row.id
      }
    }
    // 低于阈值认为没找到对应记录
    if (bestId && bestScore >= 0.35) matched.set(bestId, target)
  }
  return [...matched].map(([id, target]) => ({ id, target }))
}

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

    // ── 取消 / 删除 / 改期：把抽取到的目标条目匹配到已有记录并执行操作 ──
    if (outcome.intent === 'cancel' || outcome.intent === 'delete' || outcome.intent === 'update') {
      const matched = matchExistingEntries(outcome.entries, rows)
      const now = new Date(nowMs)
      let affected = 0
      for (const { id, target } of matched) {
        if (outcome.intent === 'cancel') {
          await db
            .update(tables.entries)
            .set({ status: 'archived', archivedAt: now, updatedAt: now })
            .where(eq(tables.entries.id, id))
          affected++
        } else if (outcome.intent === 'delete') {
          await removeEntryEmbedding(id)
          await db.delete(tables.entries).where(eq(tables.entries.id, id))
          affected++
        } else {
          // update：改期（time）/ 改标题（updates.title）/ 改内容（updates.content）
          const row = rows.find((r) => r.id === id)
          const newStart = target.time?.start
          const newTitle = target.updates?.title
          const newContent = target.updates?.content
          const patch: {
            startAt?: Date | null
            endAt?: Date | null
            title?: string
            content?: string
            updatedAt: Date
          } = { updatedAt: now }
          let changed = false
          const hasFieldUpdates = Boolean(newTitle || newContent)
          // 改期：仅在「纯改期」（无标题/内容更新）时采信 time。
          // 改标题/内容时 LLM 常顺带填入时间（甚至是猜测的），采信会误改日程时间。
          if (!hasFieldUpdates && newStart && newStart !== row?.startAt?.getTime()) {
            const previousStart = row?.startAt?.getTime()
            const previousEnd = row?.endAt?.getTime()
            const duration =
              previousStart !== null &&
              previousStart !== undefined &&
              previousEnd !== null &&
              previousEnd !== undefined
                ? previousEnd - previousStart
                : null
            patch.startAt = new Date(newStart)
            patch.endAt = target.time?.end
              ? new Date(target.time.end)
              : duration !== null
                ? new Date(newStart + duration)
                : null
            changed = true
          }
          if (newTitle && newTitle !== row?.title) {
            patch.title = newTitle
            changed = true
          }
          if (newContent && newContent !== row?.content) {
            patch.content = newContent
            changed = true
          }
          if (!changed) continue
          await db.update(tables.entries).set(patch).where(eq(tables.entries.id, id))
          // 标题或内容变化会影响向量，需重建（仅改期不用）
          if (row && (newTitle || newContent)) {
            await syncEntryEmbedding(id, newTitle ?? row.title, newContent ?? row.content)
          }
          affected++
        }
      }

      const actionText =
        outcome.intent === 'cancel' ? '已取消' : outcome.intent === 'delete' ? '已删除' : '已更新'
      const reply =
        affected > 0
          ? `${actionText} ${affected} 条记录。`
          : outcome.intent === 'update'
            ? '没有找到对应的记录，或没能识别出要修改的内容。'
            : '没有找到对应的记录，可能已被处理或不存在。'

      logger.info('extract.route', `${outcome.intent} 操作完成`, {
        libraryId: body.libraryId,
        intent: outcome.intent,
        matchedIds: matched.map((m) => m.id),
        affected,
        targetCount: outcome.entries.length,
      })

      res.json({
        ...outcome,
        entries: [],
        reply,
        draftEntryId: null,
        source: {
          sessionId: body.sessionId ?? null,
          libraryId: body.libraryId,
        },
      })
      return
    }

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
