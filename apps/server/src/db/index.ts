/**
 * 数据库门面 — 根据 DATABASE_DRIVER 自动切换
 *
 *   DATABASE_DRIVER=sqlite   → 本地 SQLite 文件（默认，零依赖）
 *   DATABASE_DRIVER=postgres → 连接 PostgreSQL + pgvector（生产推荐）
 *
 * 向上暴露统一的 getDb() 接口，SQLite 模式返回 better-sqlite3 实例，
 * PostgreSQL 模式返回 postgres.js 包装后的"类 SQLite"实例。
 * 上层 9 个调用方（routes/services）全部用 getDb().prepare(sql).run() 风格，无需改动。
 */

import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'

const DRIVER = process.env.DATABASE_DRIVER || 'sqlite'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─────────────────────────────────────────────
// SQLite 实现（默认）
// ─────────────────────────────────────────────
import Database from 'better-sqlite3'

let sqliteDb: Database.Database | null = null

const initSqlite = () => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/knowledge.db')
  sqliteDb = new Database(dbPath)

  sqliteDb.pragma('journal_mode = WAL')
  sqliteDb.pragma('foreign_keys = ON')

  // 文档表
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      chunk_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 文档块表（含向量）
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      embedding TEXT,
      FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `)

  // 会话表
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      model TEXT NOT NULL DEFAULT 'glm-4-flash',
      system_prompt TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 消息表
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)

  // Agent 状态表
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_states (
      thread_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      current_node TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 工具调用记录表
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      args_json TEXT NOT NULL,
      result_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    )
  `)

  // Generator 状态表
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS generator_states (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // 索引
  sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id)`)
  sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`)
  sqliteDb.exec(`CREATE INDEX IF NOT EXISTS idx_tool_calls_session_id ON tool_calls(session_id)`)
}

// ─────────────────────────────────────────────
// PostgreSQL 实现（包装 postgres.js 为 SQLite 风格）
// ─────────────────────────────────────────────
import pg from 'postgres'

let pgClient: ReturnType<typeof pg> | null = null

/**
 * 把 PostgreSQL 的 $1, $2 参数占位符转换成 postgres.js 的 unsafe() 调用
 * 包装成和 better-sqlite3 兼容的接口（同步外观，内部 async）
 *
 * ⚠️ 重要：PG 模式下 run/get/all 返回的实际是 Promise，
 *    但为了和上层同步代码兼容，这里返回同步接口的形状。
 *    真正切 PG 时需要把上层调用全部加 await。
 */
const wrapPostgresAsSqlite = (client: ReturnType<typeof pg>) => {
  const wrapper = {
    prepare(sql: string) {
      return {
        run(...params: any[]) {
          return client.unsafe(sql, params as any).then((rows: any[]) => ({
            lastInsertRowid: rows?.[0]?.id,
            changes: rows?.length ?? 0,
          })) as any
        },
        get(...params: any[]) {
          return client.unsafe(sql, params as any).then((rows: any[]) => rows?.[0]) as any
        },
        all(...params: any[]) {
          return client.unsafe(sql, params as any) as any
        },
      }
    },
    /** 模拟 SQLite 的 transaction() —— PG 版本内部用 pg transaction */
    transaction<T>(fn: () => T) {
      return async () => {
        if (!client) throw new Error('PG client not available')
        return await client.begin(async (sql) => {
          // 在 transaction 里，用 sql 替代原来的 unsafe
          // 但上层传入的 fn 里用的是 this.prepare，所以我们把 prepare 临时替换
          // 简化处理：直接执行 fn
          return await fn()
        })
      }
    },
    // 暴露原始 postgres.js 客户端给 PG 特有功能（如 pgvector）
    rawClient: client,
    // 模拟 SQLite 的 exec（DDL）
    exec(sql: string) {
      return client.unsafe(sql)
    },
  }
  return wrapper as any
}

type PgDbLike = ReturnType<typeof wrapPostgresAsSqlite> | Database.Database

let pgDbWrapper: PgDbLike | null = null

const initPostgres = () => {
  const url = process.env.DATABASE_URL || 'postgresql://ai_study:123456@localhost:5432/ai_study'
  pgClient = pg(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  })
  pgDbWrapper = wrapPostgresAsSqlite(pgClient)
}

// ─────────────────────────────────────────────
// 公共导出
// ─────────────────────────────────────────────

export const initDatabase = () => {
  if (DRIVER === 'postgres') {
    console.log('📊 Database driver: PostgreSQL')
    initPostgres()
    // PG 表已通过 scripts/init-pg.sql 创建，这里不建表
  } else {
    console.log('📊 Database driver: SQLite (default)')
    initSqlite()
  }
}

/**
 * 获取数据库实例
 * - SQLite 模式：返回 better-sqlite3 Database 实例（同步 API）
 * - PostgreSQL 模式：返回适配后的包装对象（prepare().run() 返回 Promise）
 *
 * ⚠️ 注意：PG 模式下 run/get/all 返回的是 Promise，上层调用需要 await
 *    如果上层代码还没适配 async，可以先保持 sqlite 驱动开发
 */
export const getDb = () => {
  if (DRIVER === 'postgres') {
    if (!pgDbWrapper) throw new Error('PostgreSQL not initialized. Call initDatabase() first.')
    return pgDbWrapper
  }
  if (!sqliteDb) throw new Error('SQLite not initialized. Call initDatabase() first.')
  return sqliteDb
}

export const getDriver = () => DRIVER as 'sqlite' | 'postgres'

/**
 * 获取 PG 原生客户端（用于 pgvector 特有操作）
 * 只有 DATABASE_DRIVER=postgres 时可用
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
    pgDbWrapper = null
  }
  // SQLite 不用显式关闭
}
