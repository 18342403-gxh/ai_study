/**
 * 账号读写 — 超管初始化、临时账号创建与查询。
 * 密码只在创建时以明文返回一次，数据库只保存 scrypt 哈希。
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, lte } from 'drizzle-orm'

import { getDb, tables } from '../../db/index.js'
import { logger } from '../logger.js'
import { hashPassword } from './password.js'
import type { AuthUser, UserRole, UserRowLike } from './types.js'

export const ADMIN_ID = 'local'
export const ADMIN_LIBRARY_ID = 'default'

const SESSION_TTL_DAYS = Math.max(1, Number(process.env.AUTH_SESSION_TTL_DAYS || 7) || 7)
export const AUTH_SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000

const TEMP_TTL_HOURS = Math.max(1, Number(process.env.TEMP_ACCOUNT_TTL_HOURS || 24) || 24)
export const TEMP_ACCOUNT_TTL_MS = TEMP_TTL_HOURS * 60 * 60 * 1000

type UserRow = typeof tables.users.$inferSelect

export const isExpired = (row: Pick<UserRow, 'expiresAt'>): boolean =>
  row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()

export const toAuthUser = (
  row: Pick<UserRowLike, 'id' | 'username' | 'role' | 'libraryId' | 'expiresAt'>,
): AuthUser => ({
  id: row.id,
  username: row.username,
  role: row.role as UserRole,
  libraryId: row.libraryId,
  expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
})

const USERNAME_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789'
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

const randomString = (length: number, alphabet: string): string => {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

const uniqueUsername = async (): Promise<string> => {
  const db = getDb()
  for (let attempt = 0; attempt < 20; attempt++) {
    const username = `temp-${randomString(6, USERNAME_ALPHABET)}`
    const rows = await db
      .select({ id: tables.users.id })
      .from(tables.users)
      .where(eq(tables.users.username, username))
      .limit(1)
    if (!rows[0]) return username
  }
  // 极端冲突时用完整随机串兜底
  return `temp-${randomUUID().replace(/-/g, '')}`
}

/** 首次启动创建超管；已存在则保持原密码不变 */
export const ensureAdmin = async (): Promise<void> => {
  const db = getDb()
  const rows = await db.select().from(tables.users).where(eq(tables.users.role, 'admin')).limit(1)
  if (rows[0]) return

  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || 'admin129'
  const passwordHash = await hashPassword(password)
  const now = new Date()

  await db.insert(tables.users).values({
    id: ADMIN_ID,
    username,
    passwordHash,
    role: 'admin',
    libraryId: ADMIN_LIBRARY_ID,
    status: 'active',
    expiresAt: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  })

  logger.info('auth.users', '已初始化超管账号', { username })
}

export const findUserByUsername = async (username: string): Promise<UserRow | undefined> => {
  const db = getDb()
  const rows = await db
    .select()
    .from(tables.users)
    .where(eq(tables.users.username, username.trim()))
    .limit(1)
  return rows[0]
}

export const findUserById = async (id: string): Promise<UserRow | undefined> => {
  const db = getDb()
  const rows = await db.select().from(tables.users).where(eq(tables.users.id, id)).limit(1)
  return rows[0]
}

export const listTempUsers = async () => {
  const db = getDb()
  const rows = await db
    .select()
    .from(tables.users)
    .where(and(eq(tables.users.role, 'temp'), eq(tables.users.status, 'active')))
    .orderBy(desc(tables.users.createdAt))

  const now = Date.now()
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    libraryId: row.libraryId,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
    remainingMs: row.expiresAt ? Math.max(0, row.expiresAt.getTime() - now) : null,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.getTime() : null,
  }))
}

export interface CreateTempUserResult {
  id: string
  username: string
  password: string
  libraryId: string
  expiresAt: number
}

export const createTempUser = async (createdBy?: string | null): Promise<CreateTempUserResult> => {
  const db = getDb()
  const id = randomUUID()
  const username = await uniqueUsername()
  const password = randomString(12, PASSWORD_ALPHABET)
  const passwordHash = await hashPassword(password)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TEMP_ACCOUNT_TTL_MS)

  await db.insert(tables.users).values({
    id,
    username,
    passwordHash,
    role: 'temp',
    // 一人一库：库 id 与账号 id 相同
    libraryId: id,
    status: 'active',
    expiresAt,
    createdBy: createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  })

  logger.info('auth.users', '已创建临时账号', { userId: id, username, expiresAt })
  return { id, username, password, libraryId: id, expiresAt: expiresAt.getTime() }
}

export const touchLastLogin = async (id: string): Promise<void> => {
  const db = getDb()
  await db.update(tables.users).set({ lastLoginAt: new Date() }).where(eq(tables.users.id, id))
}

/** 过期但仍未清理的临时账号（后台扫描用） */
export const listExpiredTempUsers = async (): Promise<UserRow[]> => {
  const db = getDb()
  return db
    .select()
    .from(tables.users)
    .where(
      and(
        eq(tables.users.role, 'temp'),
        eq(tables.users.status, 'active'),
        lte(tables.users.expiresAt, new Date()),
      ),
    )
}
