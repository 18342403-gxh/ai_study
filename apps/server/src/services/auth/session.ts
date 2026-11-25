/**
 * 登录态 — token 只以 sha256 哈希落库，浏览器持有 HttpOnly Cookie。
 */

import { createHash, randomBytes } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import type { Response } from 'express'

import { getDb, tables } from '../../db/index.js'
import { isExpired, toAuthUser } from './users.js'
import type { AuthUser } from './types.js'

export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'ais_session'

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const result: Record<string, string> = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) result[key] = decodeURIComponent(value)
  }
  return result
}

interface CookieRequest {
  protocol: string
  get(name: string): string | undefined
  headers: { cookie?: string }
}

const isSecureRequest = (req: CookieRequest): boolean =>
  req.protocol === 'https' || req.get('x-forwarded-proto') === 'https'

export const setSessionCookie = (
  req: CookieRequest,
  res: Response,
  token: string,
  maxAgeMs: number,
) => {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isSecureRequest(req),
    maxAge: maxAgeMs,
  })
}

export const clearSessionCookie = (req: CookieRequest, res: Response) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isSecureRequest(req),
  })
}

export const getSessionToken = (req: { headers: { cookie?: string } }): string | null =>
  parseCookies(req.headers.cookie)[AUTH_COOKIE_NAME] ?? null

export const createSession = async (params: {
  userId: string
  expiresAt: Date
  userAgent?: string
  ip?: string
}): Promise<string> => {
  const token = randomBytes(32).toString('base64url')
  await getDb()
    .insert(tables.authSessions)
    .values({
      tokenHash: hashToken(token),
      userId: params.userId,
      expiresAt: params.expiresAt,
      userAgent: params.userAgent?.slice(0, 500) ?? null,
      ip: params.ip?.slice(0, 64) ?? null,
    })
  return token
}

export const deleteSession = async (token: string): Promise<void> => {
  await getDb()
    .delete(tables.authSessions)
    .where(eq(tables.authSessions.tokenHash, hashToken(token)))
}

export type SessionLookup =
  | { status: 'missing' }
  | { status: 'expired'; user: AuthUser }
  | { status: 'ok'; user: AuthUser; sessionExpiresAt: Date }

/** 查登录态；不按 session 过期过滤，便于识别到期账号并触发清理 */
export const lookupSession = async (token: string): Promise<SessionLookup> => {
  const db = getDb()
  const rows = await db
    .select({
      expiresAt: tables.authSessions.expiresAt,
      id: tables.users.id,
      username: tables.users.username,
      role: tables.users.role,
      libraryId: tables.users.libraryId,
      userExpiresAt: tables.users.expiresAt,
      status: tables.users.status,
    })
    .from(tables.authSessions)
    .innerJoin(tables.users, eq(tables.authSessions.userId, tables.users.id))
    .where(eq(tables.authSessions.tokenHash, hashToken(token)))
    .limit(1)

  const row = rows[0]
  if (!row) return { status: 'missing' }

  const user = toAuthUser({
    id: row.id,
    username: row.username,
    role: row.role,
    libraryId: row.libraryId,
    expiresAt: row.userExpiresAt,
  })

  if (
    row.status !== 'active' ||
    row.expiresAt.getTime() <= Date.now() ||
    isExpired({ expiresAt: row.userExpiresAt })
  ) {
    return { status: 'expired', user }
  }

  return { status: 'ok', user, sessionExpiresAt: row.expiresAt }
}

/** 清理单个用户的过期登录态（登录时顺带执行） */
export const deleteStaleSessions = async (userId: string): Promise<void> => {
  const db = getDb()
  const now = new Date()
  await db
    .delete(tables.authSessions)
    .where(and(eq(tables.authSessions.userId, userId), lt(tables.authSessions.expiresAt, now)))
}
