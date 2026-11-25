/**
 * 认证中间件 — Cookie 登录态校验与超管权限。
 */

import type { NextFunction, Request, Response } from 'express'

import { asyncHandler, createError } from './errorHandler.js'
import {
  clearSessionCookie,
  deleteSession,
  getSessionToken,
  lookupSession,
} from '../services/auth/session.js'
import { purgeUser } from '../services/auth/purge.js'
import { logger } from '../services/logger.js'
import type { AuthUser } from '../services/auth/types.js'

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/apply-temp',
])

const isPublicPath = (req: Request): boolean =>
  req.method === 'OPTIONS' || PUBLIC_PATHS.has(req.path)

/** 取当前登录账号；未经过认证中间件时直接抛 401 */
export const requireUser = (req: { authUser?: AuthUser }): AuthUser => {
  if (!req.authUser) throw createError('请先登录', 401, 'UNAUTHORIZED')
  return req.authUser
}

export const authenticate = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (isPublicPath(req)) {
      next()
      return
    }

    const token = getSessionToken(req)
    if (!token) throw createError('请先登录', 401, 'UNAUTHORIZED')

    const lookup = await lookupSession(token)
    if (lookup.status === 'missing') {
      clearSessionCookie(req, res)
      throw createError('登录已失效，请重新登录', 401, 'UNAUTHORIZED')
    }

    if (lookup.status === 'expired') {
      clearSessionCookie(req, res)
      if (lookup.user.role === 'temp') {
        try {
          await purgeUser(lookup.user.id)
        } catch (err) {
          logger.error('auth.middleware', '过期账号清理失败', {
            userId: lookup.user.id,
            error: (err as Error).message,
          })
        }
      } else {
        await deleteSession(token).catch(() => {})
      }
      throw createError('登录已过期，请重新登录', 401, 'UNAUTHORIZED')
    }

    req.authUser = lookup.user
    next()
  },
)

export const requireAdmin = (req: Request, _res: Response, next: NextFunction) => {
  const user = req.authUser
  if (!user) return next(createError('请先登录', 401, 'UNAUTHORIZED'))
  if (user.role !== 'admin') return next(createError('仅超管可操作', 403, 'FORBIDDEN'))
  next()
}
