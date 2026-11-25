/**
 * 临时账号销毁 — 账号与其知识库一并清理。
 * 文档文件先尽力删除，再在单事务内清理数据库记录。
 */

import { unlink } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { eq } from 'drizzle-orm'

import { getDb, tables } from '../../db/index.js'
import { logger } from '../logger.js'
import { listExpiredTempUsers } from './users.js'

const removeStoredFile = async (storagePath: string): Promise<void> => {
  if (!storagePath || /^https?:\/\//i.test(storagePath)) return
  if (!isAbsolute(storagePath)) return
  try {
    await unlink(storagePath)
  } catch {
    /* 文件已不存在或不可删除，忽略 */
  }
}

/** 销毁临时账号及其知识库；超管账号不会被删除 */
export const purgeUser = async (userId: string): Promise<boolean> => {
  const db = getDb()
  const rows = await db.select().from(tables.users).where(eq(tables.users.id, userId)).limit(1)
  const user = rows[0]
  if (!user) return false
  if (user.role !== 'temp') {
    logger.warn('auth.purge', '拒绝销毁非临时账号', { userId, role: user.role })
    return false
  }

  const docs = await db
    .select({ storagePath: tables.documents.storagePath })
    .from(tables.documents)
    .where(eq(tables.documents.libraryId, user.libraryId))
  await Promise.all(docs.map((doc) => removeStoredFile(doc.storagePath)))

  await db.transaction(async (tx) => {
    await tx.delete(tables.documents).where(eq(tables.documents.libraryId, user.libraryId))
    await tx.delete(tables.entries).where(eq(tables.entries.libraryId, user.libraryId))
    await tx.delete(tables.plans).where(eq(tables.plans.libraryId, user.libraryId))
    await tx.delete(tables.sessions).where(eq(tables.sessions.userId, userId))
    await tx.delete(tables.aiUsageLogs).where(eq(tables.aiUsageLogs.userId, userId))
    await tx.delete(tables.authSessions).where(eq(tables.authSessions.userId, userId))
    await tx.delete(tables.users).where(eq(tables.users.id, userId))
  })

  logger.info('auth.purge', '临时账号及其知识库已销毁', {
    userId,
    username: user.username,
    libraryId: user.libraryId,
    documents: docs.length,
  })
  return true
}

/** 后台扫描：清理所有已到期的临时账号 */
export const sweepExpiredUsers = async (): Promise<number> => {
  const expired = await listExpiredTempUsers()
  let purged = 0
  for (const user of expired) {
    try {
      if (await purgeUser(user.id)) purged++
    } catch (err) {
      logger.error('auth.purge', '清理过期账号失败', {
        userId: user.id,
        error: (err as Error).message,
      })
    }
  }
  return purged
}
