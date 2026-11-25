/**
 * PostgreSQL 数据访问门面。
 * 结构由 scripts/init-pg.sql 显式初始化，应用启动只验证连接、扩展与必要表结构。
 */

import 'dotenv/config'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import pg from 'postgres'

import * as pgSchema from '../../drizzle/schema.js'
import { logger } from '../services/logger.js'

export type AppDb = PostgresJsDatabase<typeof pgSchema>
export const tables = pgSchema

const REQUIRED_TABLES = [
  'documents',
  'chunks',
  'sessions',
  'messages',
  'entries',
  'entry_embeddings',
  'ai_usage_logs',
  'plans',
  'users',
  'auth_sessions',
] as const

let pgClient: ReturnType<typeof pg> | null = null
let pgDrizzle: AppDb | null = null
let initializing: Promise<void> | null = null

const validateSchema = async (client: ReturnType<typeof pg>): Promise<void> => {
  const [extension] = await client<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists
  `
  if (!extension?.exists) {
    throw new Error('pgvector extension is missing. Run pnpm --filter @ai-study/server db:init.')
  }

  const tableRows = await client<{ tableName: string }[]>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'app'
      AND table_name IN ('documents','chunks','sessions','messages','entries','entry_embeddings','ai_usage_logs','plans','users','auth_sessions')
  `
  const existingTables = new Set(tableRows.map((row) => row.tableName))
  const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.has(table))
  if (missingTables.length > 0) {
    throw new Error(
      `Required PostgreSQL tables are missing: ${missingTables.join(', ')}. Run pnpm --filter @ai-study/server db:init.`,
    )
  }

  const vectorColumns = await client<{ tableName: string; dataType: string }[]>`
    SELECT c.relname AS "tableName", format_type(a.atttypid, a.atttypmod) AS "dataType"
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app'
      AND a.attname = 'embedding'
      AND NOT a.attisdropped
      AND c.relname IN ('chunks', 'entry_embeddings')
  `
  const columnTypes = new Map(vectorColumns.map((row) => [row.tableName, row.dataType]))
  for (const table of ['chunks', 'entry_embeddings']) {
    if (columnTypes.get(table) !== 'vector(1536)') {
      throw new Error(
        `app.${table}.embedding must be vector(1536), found ${columnTypes.get(table) ?? 'missing column'}. Run pnpm --filter @ai-study/server db:init.`,
      )
    }
  }
}

const connect = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Configure PostgreSQL before starting the server.')
  }

  const client = pg(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  })

  try {
    await client`SELECT 1`
    await validateSchema(client)
    pgClient = client
    pgDrizzle = drizzle(client, { schema: pgSchema })
    logger.info('db', 'PostgreSQL 连接与结构校验完成')
  } catch (error) {
    await client.end({ timeout: 5 }).catch(() => {})
    throw error
  }
}

export const initDatabase = async (): Promise<void> => {
  if (pgDrizzle) return
  if (!initializing) {
    initializing = connect().finally(() => {
      initializing = null
    })
  }
  await initializing
}

export const getDb = (): AppDb => {
  if (!pgDrizzle) {
    throw new Error('PostgreSQL not initialized. Call and await initDatabase() first.')
  }
  return pgDrizzle
}

export const getPgRaw = (): ReturnType<typeof pg> => {
  if (!pgClient) {
    throw new Error('PostgreSQL not initialized. Call and await initDatabase() first.')
  }
  return pgClient
}

export const closeDatabase = async (): Promise<void> => {
  const client = pgClient
  pgClient = null
  pgDrizzle = null
  if (client) {
    await client.end({ timeout: 5 })
  }
}
