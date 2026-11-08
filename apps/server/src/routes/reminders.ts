/**
 * 简单提醒 API — spec 阶段 10
 * GET /api/reminders — 返回今天与明天的日程/规划（应用内到期提示，不做系统通知）
 *
 * 复用时间通道：窗口 [今天 00:00, 后天 00:00)，重复规则已展开为实例。
 */

import { Router } from 'express'
import { z } from 'zod'

import { searchTimeChannel } from '../services/search/timeChannel.js'
import { addLocalDays, startOfLocalDay } from '../services/extract/timeParse.js'
import { validate, asyncHandler } from '../middleware/index.js'

const router = Router()

const remindersQuerySchema = z.object({
  libraryId: z.string().max(64).default('default'),
})

interface ReminderItem {
  id: string
  type: string
  title: string
  startAt: number
  endAt: number | null
  occurrence: boolean
}

/** GET /api/reminders */
router.get(
  '/',
  validate({ query: remindersQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = remindersQuerySchema.parse(req.query)
    const today = startOfLocalDay(Date.now())
    const dayAfterTomorrow = addLocalDays(today, 2)

    const hits = await searchTimeChannel({
      windowStart: today,
      windowEnd: dayAfterTomorrow,
      libraryId: query.libraryId,
    })

    const tomorrow = addLocalDays(today, 1)
    const toItem = (hit: (typeof hits)[number]): ReminderItem => ({
      id: hit.entry.id,
      type: hit.entry.type,
      title: hit.entry.title,
      startAt: hit.startAt,
      endAt: hit.endAt,
      occurrence: hit.occurrence,
    })

    res.json({
      today: hits.filter((h) => h.startAt < tomorrow).map(toItem),
      tomorrow: hits.filter((h) => h.startAt >= tomorrow).map(toItem),
    })
  }),
)

export default router
