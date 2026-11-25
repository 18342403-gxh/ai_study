/**
 * 登录 / 登出 / 当前账号
 * POST /api/auth/login
 * POST /api/auth/logout
 * GET  /api/auth/me
 */

import { Router } from 'express'
import { z } from 'zod'

import { validate, asyncHandler, createError } from '../middleware/index.js'
import { requireUser } from '../middleware/auth.js'
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  deleteStaleSessions,
  getSessionToken,
  setSessionCookie,
} from '../services/auth/session.js'
import { verifyPassword } from '../services/auth/password.js'
import {
  AUTH_SESSION_TTL_MS,
  createTempUser,
  findUserByUsername,
  toAuthUser,
  touchLastLogin,
} from '../services/auth/users.js'
import { purgeUser } from '../services/auth/purge.js'
import { logger } from '../services/logger.js'

const router = Router()

const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名').max(64),
  password: z.string().min(1, '请输入密码').max(200),
})

/** POST /api/auth/login */
router.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body)
    const user = await findUserByUsername(username)

    if (!user || user.status !== 'active') {
      throw createError('用户名或密码错误', 401, 'INVALID_CREDENTIALS')
    }

    if (user.role === 'temp' && user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
      await purgeUser(user.id).catch(() => {})
      throw createError('临时账号已过期', 401, 'ACCOUNT_EXPIRED')
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) throw createError('用户名或密码错误', 401, 'INVALID_CREDENTIALS')

    await deleteStaleSessions(user.id)

    const now = Date.now()
    const sessionLimit = now + AUTH_SESSION_TTL_MS
    const accountLimit = user.expiresAt ? user.expiresAt.getTime() : Number.POSITIVE_INFINITY
    const expiresAt = new Date(Math.min(sessionLimit, accountLimit))
    const maxAgeMs = Math.max(1000, expiresAt.getTime() - now)

    const token = await createSession({
      userId: user.id,
      expiresAt,
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    })
    setSessionCookie(req, res, token, maxAgeMs)
    await touchLastLogin(user.id)

    logger.info('auth.route', '登录成功', { userId: user.id, role: user.role })
    res.json({ user: toAuthUser(user) })
  }),
)

/** POST /api/auth/logout */
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = getSessionToken(req)
    if (token) await deleteSession(token).catch(() => {})
    clearSessionCookie(req, res)
    res.json({ ok: true })
  }),
)

/** GET /api/auth/me */
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ user: requireUser(req) })
  }),
)

/** POST /api/auth/apply-temp — 公开申请临时账号（无需登录） */
router.post(
  '/apply-temp',
  asyncHandler(async (_req, res) => {
    if (process.env.ALLOW_PUBLIC_TEMP_APPLY === 'false') {
      throw createError('公开申请已关闭，请联系管理员', 403, 'PUBLIC_APPLY_DISABLED')
    }
    const result = await createTempUser(null)
    logger.info('auth.route', '公开申请临时账号', { username: result.username })
    res.status(201).json(result)
  }),
)

export default router
