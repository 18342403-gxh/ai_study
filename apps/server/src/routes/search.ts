/**
 * 检索调试接口 — v5 阶段 6（spec 4.5 / 7 接口契约）
 *
 * POST /api/search — 返回三路检索结果、通道得分、加权分与汇总行
 *
 * 约定：
 *   - 只读，不写库
 *   - 时间窗口默认由查询理解给出；调试可显式传 timeRange 或 skipUnderstanding
 *   - 空结果返回 200 + empty=true，由前端提示"你的记录里没有相关内容"
 */

import { Router } from 'express'
import { z } from 'zod'

import { asyncHandler, validate } from '../middleware/index.js'
import { logger } from '../services/logger.js'
import { searchAll } from '../services/search/searchAll.js'
import { formatDateTime, getLocalTimezone } from '../services/extract/timeParse.js'

const router = Router()

const timeRangeSchema = z
  .object({
    start: z.number().int(),
    end: z.number().int(),
  })
  .refine((value) => value.end > value.start, { message: 'timeRange.end 必须晚于 start' })

const searchSchema = z.object({
  query: z.string().trim().min(1, '查询不能为空').max(500, '查询不能超过 500 字'),
  libraryId: z.string().max(64).default('default'),
  /** 调试用：显式指定时间窗口（毫秒） */
  timeRange: timeRangeSchema.nullable().optional(),
  /** 历史查询：放宽到 archived */
  includeArchived: z.boolean().default(false),
  /** 不调用模型，直接用规则解析查询 */
  skipUnderstanding: z.boolean().default(false),
})

/** POST /api/search — 检索 */
router.post(
  '/',
  validate({ body: searchSchema }),
  asyncHandler(async (req, res) => {
    const body = searchSchema.parse(req.body)
    const timezone = getLocalTimezone()

    const outcome = await searchAll({
      query: body.query,
      libraryId: body.libraryId,
      timezone,
      timeRange: body.timeRange,
      includeArchived: body.includeArchived,
      skipUnderstanding: body.skipUnderstanding,
    })

    logger.info('search.route', 'POST / 完成', {
      libraryId: body.libraryId,
      resultCount: outcome.results.length,
      empty: outcome.empty,
      understandingSource: outcome.understanding.source,
    })

    res.json({
      ok: true,
      query: body.query,
      libraryId: body.libraryId,
      understanding: {
        needsPersonalContext: outcome.understanding.needsPersonalContext,
        timeRange: outcome.understanding.timeRange,
        keywords: outcome.understanding.keywords,
        entityTypes: outcome.understanding.entityTypes,
        source: outcome.understanding.source,
      },
      window: outcome.window
        ? {
            start: outcome.window.start,
            end: outcome.window.end,
            startText: formatDateTime(outcome.window.start, timezone),
            endText: formatDateTime(outcome.window.end, timezone),
          }
        : null,
      results: outcome.results.map((item) => ({
        ...item,
        startText: item.startAt !== null ? formatDateTime(item.startAt, timezone) : null,
        endText: item.endAt !== null ? formatDateTime(item.endAt, timezone) : null,
      })),
      summary: outcome.summary,
      channels: outcome.channels,
      degraded: {
        embeddingMock: outcome.embeddingMock,
        understanding: outcome.understanding.source,
      },
      empty: outcome.empty,
      message: outcome.empty ? '你的记录里没有相关内容' : null,
    })
  }),
)

export default router
