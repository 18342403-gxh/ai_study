/**
 * 数据库门面 — 统一 Drizzle ORM 数据访问层
 *
 *   DATABASE_DRIVER=sqlite   → 本地 SQLite 文件（默认，零依赖）
 *   DATABASE_DRIVER=postgres → 连接 PostgreSQL + pgvector（生产推荐）
 *
 * 设计：
 *   - 双方言共用一套 camelCase schema 属性名（sqliteSchema / pgSchema 一一对应）
 *   - getDb() 返回 drizzle 实例，编译期类型以 SQLite schema 为准（AppDb）
 *   - tables 导出当前驱动的表对象，业务层只写方言无关的 drizzle 查询
 *   - 时间戳统一 Date 对象（SQLite integer ms ↔ timestamp_ms；PG timestamptz）
 *   - JSON 列自动序列化（messages.metadata 除外：保持手动 string 透传）
 *   - getPgRaw() 是逃生舱：pgvector `<=>` 等 drizzle 表达不了的操作用原生 client
 */

import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import pg from 'postgres'

import * as sqliteSchema from '../../drizzle/schema.sqlite.js'
import * as pgSchema from '../../drizzle/schema.js'
import { logger } from '../services/logger.js'

const DRIVER = process.env.DATABASE_DRIVER || 'sqlite'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 统一数据访问层类型（编译期以 SQLite schema 为准，双方言属性名一致） */
export type AppDb = BetterSQLite3Database<typeof sqliteSchema>

/**
 * 当前驱动的表对象。运行时按驱动切换，编译期类型固定为 sqliteSchema
 * （两个 schema 的 camelCase 属性名必须完全一致）。
 */
export const tables = (DRIVER === 'postgres'
  ? pgSchema
  : sqliteSchema) as unknown as typeof sqliteSchema

// ─────────────────────────────────────────────
// SQLite 初始化（含幂等建表与结构对齐）
// ─────────────────────────────────────────────

let sqliteDb: Database.Database | null = null
let sqliteDrizzle: BetterSQLite3Database<typeof sqliteSchema> | null = null

/** v5 个人记忆系统建表：entries / entry_embeddings / ai_usage_logs（幂等） */
const initV5Schema = (db: Database.Database) => {
  // 条目表（个人记忆系统核心，v5）
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      library_id TEXT NOT NULL DEFAULT 'default',
      type TEXT NOT NULL CHECK(type IN ('schedule','plan','fact','note')),
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','active','done','archived')),
      start_at INTEGER,
      end_at INTEGER,
      recurrence TEXT,
      recurrence_until INTEGER,
      exceptions TEXT,
      source_type TEXT NOT NULL DEFAULT 'conversation'
        CHECK(source_type IN ('conversation','document','manual')),
      source_ref TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_status_type ON entries(status, type)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_start ON entries(start_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_library ON entries(library_id, status)`)

  // 条目向量表（语义检索用，条目本身即最小记忆单元，不再拆分）
  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_embeddings (
      entry_id TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
    )
  `)

  // AI Token 用量日志表（成本控制核心）
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id TEXT PRIMARY KEY,
      feature TEXT NOT NULL CHECK(feature IN ('chat','generator','rag','embedding','eval')),
      model TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'zhipu',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_ms INTEGER NOT NULL DEFAULT 0,
      user_id TEXT,
      session_id TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON ai_usage_logs(created_at)`)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature ON ai_usage_logs(feature, created_at)`,
  )
}

/** 结构对齐：把旧版 SQLite 表结构升级到与 PG schema 一致的列集（幂等） */
const alignSqliteSchema = (db: Database.Database) => {
  const hasColumn = (table: string, column: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return cols.some((c) => c.name === column)
  }
  const ensureColumn = (table: string, column: string, ddl: string) => {
    if (!hasColumn(table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
    }
  }

  // documents：旧列 type → mime_type（RENAME COLUMN 需 SQLite 3.25+）
  if (hasColumn('documents', 'type') && !hasColumn('documents', 'mime_type')) {
    db.exec(`ALTER TABLE documents RENAME COLUMN type TO mime_type`)
  }
  ensureColumn('documents', 'storage_path', `storage_path TEXT NOT NULL DEFAULT ''`)
  ensureColumn('documents', 'metadata', 'metadata TEXT')
  ensureColumn('documents', 'deleted_at', 'deleted_at INTEGER')

  // chunks：补 token_count / created_at
  ensureColumn('chunks', 'token_count', 'token_count INTEGER')
  ensureColumn('chunks', 'created_at', 'created_at INTEGER')

  // sessions：补 metadata / deleted_at
  ensureColumn('sessions', 'metadata', 'metadata TEXT')
  ensureColumn('sessions', 'deleted_at', 'deleted_at INTEGER')

  // messages：补 tool_call_id
  ensureColumn('messages', 'tool_call_id', 'tool_call_id TEXT')
}

const initSqlite = () => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/knowledge.db')
  sqliteDb = new Database(dbPath)

  sqliteDb.pragma('journal_mode = WAL')
  sqliteDb.pragma('foreign_keys = ON')

  // 文档表（新库直接建全量列；旧库由 alignSqliteSchema 升级）
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime_type TEXT,
      storage_path TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'processing'
        CHECK(status IN ('processing','ready','failed','deleted')),
      chunk_count INTEGER DEFAULT 0,
      user_id TEXT NOT NULL DEFAULT 'local',
      library_id TEXT NOT NULL DEFAULT 'default',
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `)
  sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)`)
  sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at)`)

  // 文档块表（含向量）
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      token_count INTEGER,
      embedding TEXT,
      created_at INTEGER,
      FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `)
  sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id)`)

  // 会话表
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      model TEXT NOT NULL DEFAULT 'glm-4-flash',
      system_prompt TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `)

  // 消息表
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
      content TEXT NOT NULL,
      tool_call_id TEXT,
      citations TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)
  sqliteDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_session_id_created_at ON messages(session_id, created_at)`,
  )

  // 旧库结构对齐（幂等 ALTER）
  alignSqliteSchema(sqliteDb)

  // v5 个人记忆系统建表（entries / entry_embeddings / ai_usage_logs）
  initV5Schema(sqliteDb)

  sqliteDrizzle = drizzleSqlite(sqliteDb, { schema: sqliteSchema })
}

// ─────────────────────────────────────────────
// PostgreSQL 初始化
// ─────────────────────────────────────────────

let pgClient: ReturnType<typeof pg> | null = null
let pgDrizzle: PostgresJsDatabase<typeof pgSchema> | null = null

const initPostgres = () => {
  const url = process.env.DATABASE_URL || 'postgresql://ai_study:123456@localhost:5432/ai_study'
  pgClient = pg(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  })
  pgDrizzle = drizzlePg(pgClient, { schema: pgSchema })

  // 防御性建表：schema 与 ai_usage_logs（正常应由 scripts/init-pg.sql 创建）
  pgClient.unsafe(`CREATE SCHEMA IF NOT EXISTS app`).catch(() => {})
  pgClient
    .unsafe(
      `
    CREATE TABLE IF NOT EXISTS app.ai_usage_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      feature VARCHAR(32) NOT NULL CHECK(feature IN ('chat','generator','rag','embedding','eval')),
      model VARCHAR(128) NOT NULL,
      provider VARCHAR(32) NOT NULL DEFAULT 'zhipu',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_ms INTEGER NOT NULL DEFAULT 0,
      user_id VARCHAR(64),
      session_id VARCHAR(64),
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
    )
    .catch((e: unknown) => {
      logger.debug('db', 'PG ai_usage_logs 建表跳过或已存在', { error: (e as Error).message })
    })
  pgClient
    .unsafe(`CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON app.ai_usage_logs(created_at)`)
    .catch(() => {})
  pgClient
    .unsafe(
      `CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature ON app.ai_usage_logs(feature, created_at)`,
    )
    .catch(() => {})
}

// ─────────────────────────────────────────────
// 公共导出
// ─────────────────────────────────────────────

export const initDatabase = () => {
  if (DRIVER === 'postgres') {
    initPostgres()
    logger.info('db', '数据库初始化完成', { driver: 'PostgreSQL' })
  } else {
    initSqlite()
    logger.info('db', '数据库初始化完成', { driver: 'SQLite (default)' })
  }
}

/**
 * 获取 drizzle 数据库实例（双方言统一）
 * 编译期类型为 AppDb（SQLite schema）；PG 实例运行时等价。
 */
export const getDb = (): AppDb => {
  if (DRIVER === 'postgres') {
    if (!pgDrizzle) throw new Error('PostgreSQL not initialized. Call initDatabase() first.')
    return pgDrizzle as unknown as AppDb
  }
  if (!sqliteDrizzle) throw new Error('SQLite not initialized. Call initDatabase() first.')
  return sqliteDrizzle
}

export const getDriver = () => DRIVER as 'sqlite' | 'postgres'

/**
 * 获取 PG 原生客户端（逃生舱：pgvector `<=>` 等 drizzle 表达不了的操作）
 */
export const getPgRaw = () => {
  if (DRIVER !== 'postgres') return null
  return pgClient
}

/**
 * 关闭连接池
 */
export const closeDatabase = async () => {
  if (DRIVER === 'postgres' && pgClient) {
    await pgClient.end({ timeout: 5 })
    pgClient = null
    pgDrizzle = null
  }
  if (sqliteDb) {
    sqliteDb.close()
    sqliteDb = null
    sqliteDrizzle = null
  }
}
