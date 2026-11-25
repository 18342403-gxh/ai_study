/**
 * 超管 — 临时账号管理
 * GET    /api/admin/users
 * POST   /api/admin/users
 * DELETE /api/admin/users/:id
 */

import { Router } from 'express'
import { z } from 'zod'

import { validate, asyncHandler, createError } from '../middleware/index.js'
import { requireAdmin, requireUser } from '../middleware/auth.js'
import { createTempUser, findUserById, listTempUsers } from '../services/auth/users.js'
import { purgeUser } from '../services/auth/purge.js'
import { logger } from '../services/logger.js'

const router = Router()
router.use(requireAdmin)

const idParam = z.object({ id: z.string().min(1).max(64) })

/** GET /api/admin/users */
router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    res.json({ users: await listTempUsers() })
  }),
)

/** POST /api/admin/users — 生成临时账号（密码仅本次响应返回） */
router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const admin = requireUser(req)
    const created = await createTempUser(admin.id)
    logger.info('admin.route', '超管生成临时账号', {
      adminId: admin.id,
      userId: created.id,
      username: created.username,
    })
    res.status(201).json(created)
  }),
)

/** DELETE /api/admin/users/:id — 提前销毁账号及知识库 */
router.delete(
  '/users/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params)
    const target = await findUserById(id)
    if (!target || target.role !== 'temp') {
      throw createError('临时账号不存在', 404, 'USER_NOT_FOUND')
    }
    const admin = requireUser(req)
    await purgeUser(id)
    logger.info('admin.route', '超管删除临时账号', { adminId: admin.id, userId: id })
    res.status(204).end()
  }),
)

export default router
