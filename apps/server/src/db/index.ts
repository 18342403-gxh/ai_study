/**
 * 数据库门面 — 根据 DATABASE_DRIVER 自动切换
 *
 *   DATABASE_DRIVER=sqlite   → 本地 SQLite 文件（默认，零依赖）
 *   DATABASE_DRIVER=postgres → 连接 PostgreSQL + pgvector（生产推荐）
 *
 * ⚠️ 所有驱动统一 async API：run/get/all 均返回 Promise。
 *    SQLite 内部是同步的，这里用 Promise.resolve() 包装；
 *    PostgreSQL 是真正的 async postgres.js。
 *    上层调用必须用 await db.prepare(sql).run(...) 风格。
 */

import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../services/logger.js'

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
// 统一 async 包装器（SQLite 和 PG 共用的接口形状）
// ─────────────────────────────────────────────

interface AsyncPrepared {
  run(...params: unknown[]): Promise<{ lastInsertRowid: bigint | number | null; changes: number }>
  get<T = unknown>(...params: unknown[]): Promise<T | undefined>
  all<T = unknown>(...params: unknown[]): Promise<T[]>
}

interface AsyncDb {
  prepare(sql: string): AsyncPrepared
  exec(sql: string): Promise<unknown>
  transaction<T>(fn: () => T | Promise<T>): () => Promise<T>
  rawClient?: unknown
}

/** SQLite 同步 → async 包装 */
const wrapSqliteAsAsync = (db: Database.Database): AsyncDb => ({
  prepare(sql: string) {
    const stmt = db.prepare(sql)
    return {
      run(...params: unknown[]) {
        return Promise.resolve(stmt.run(...params) as { lastInsertRowid: bigint | number | null; changes: number })
      },
      get<T = unknown>(...params: unknown[]) {
        return Promise.resolve(stmt.get(...params) as T | undefined)
      },
      all<T = unknown>(...params: unknown[]) {
        return Promise.resolve(stmt.all(...params) as T[])
      },
    }
  },
  exec(sql: string) {
    return Promise.resolve(db.exec(sql))
  },
  transaction<T>(fn: () => T | Promise<T>) {
    return db.transaction(fn) as () => Promise<T>
  },
})

/** PG (postgres.js) → async 包装（内部已是 async） */
const wrapPostgresAsAsync = (client: ReturnType<typeof pg>): AsyncDb => {
  /**
   * 把 SQLite 风格的 ? 占位符转换成 PG 的 $1, $2, $3...
   * 只转不在引号里的 ?（避免字符串字面量里的 ? 被误转）
   */
  const sqliteToPgParams = (sql: string): string => {
    let counter = 0
    let inSingle = false
    let inDouble = false
    let escapeNext = false
    let result = ''
    for (let i = 0; i < sql.length; i++) {
      const c = sql[i]
      if (escapeNext) { result += c; escapeNext = false; continue }
      if (c === '\\') { result += c; escapeNext = true; continue }
      if (c === "'" && !inDouble) { inSingle = !inSingle; result += c; continue }
      if (c === '"' && !inSingle) { inDouble = !inDouble; result += c; continue }
      if (c === '?' && !inSingle && !inDouble) { result += `$${++counter}`; continue }
      result += c
    }
    return result
  }

  /** 把裸表名加 app schema 前缀 */
  const qualifySchema = (sql: string): string => {
    // SQL 关键字白名单（这些不是表名，不能加 schema）
    const reserved = new Set([
      'SET', 'ON', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'VALUES',
      'AND', 'OR', 'AS', 'IS', 'IN', 'NOT', 'NULL', 'LIKE', 'BETWEEN',
      'BY', 'ASC', 'DESC', 'HAVING', 'UNION', 'ALL', 'DISTINCT',
      'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'TRUE', 'FALSE',
      'RETURNING', 'DO', 'CONFLICT', 'EXCLUDED', 'DEFAULT', 'CHECK',
      'PRIMARY', 'FOREIGN', 'KEY', 'REFERENCES', 'CONSTRAINT', 'UNIQUE',
      'WITH', 'RECURSIVE', 'LATERAL', 'CROSS', 'NATURAL', 'LEFT', 'RIGHT',
      'INNER', 'OUTER', 'FULL', 'TABLESAMPLE', 'ONLY', 'USING',
    ])

    // Step 1: 标准 keyword + table 匹配
    // FROM/JOIN/INTO/UPDATE 后面的裸表名 → app.table
    let result = sql.replace(
      /\b(FROM|JOIN|INTO|UPDATE)\s+(?!app\.|public\.|pg_|information_schema\.)(\w+)/gi,
      (m, kw: string, table: string) => {
        if (reserved.has(table.toUpperCase())) return m
        return `${kw} app.${table}`
      }
    )

    // Step 2: 逗号分隔多表 — FROM app.t1, t2 中的 t2 也要加 schema
    // 匹配: FROM|JOIN app.table [alias] , bare_table
    result = result.replace(
      /((?:FROM|JOIN)\s+app\.\w+(?:\s+(?:AS\s+)?\w+)?)\s*,\s*(?!app\.|public\.|pg_|information_schema\.)(\w+)/gi,
      (m, prefix: string, table: string) => {
        if (reserved.has(table.toUpperCase())) return m
        return `${prefix}, app.${table}`
      }
    )

    return result
  }

  /**
   * 参数类型转换：SQLite 用 INTEGER 存时间戳，PG 用 TIMESTAMPTZ
   * 把看起来像毫秒时间戳的整数（> 1e12，约 2001 年后）转成 ISO 日期字符串
   */
  const coerceParams = (params: unknown[]): unknown[] => {
    return params.map((p) => {
      if (typeof p === 'number' && p > 1_000_000_000_000 && Number.isFinite(p)) {
        return new Date(p).toISOString()
      }
      return p
    })
  }

  const prepareForPg = (sql: string): string => qualifySchema(sqliteToPgParams(sql))

  // 根据 SQL 判断操作类型（用于日志 tag）
  const opType = (sql: string): string => {
    const upper = sql.trim().toUpperCase()
    if (upper.startsWith('INSERT')) return 'INSERT'
    if (upper.startsWith('UPDATE')) return 'UPDATE'
    if (upper.startsWith('DELETE')) return 'DELETE'
    if (upper.startsWith('SELECT')) return 'SELECT'
    if (upper.startsWith('CREATE')) return 'CREATE'
    if (upper.startsWith('DROP')) return 'DROP'
    if (upper.startsWith('ALTER')) return 'ALTER'
    return 'OTHER'
  }

  // 从 SQL 提取表名（简单版，用于日志 data）
  const extractTable = (sql: string): string => {
    const m = sql.match(/(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/i)
    return m?.[1] ?? '?'
  }

  return {
    prepare(sql: string) {
      const pgSql = prepareForPg(sql)
      const op = opType(sql)
      const table = extractTable(sql)
      return {
        async run(...params: unknown[]) {
          const t0 = Date.now()
          try {
            const rows: any[] = await client.unsafe(pgSql, coerceParams(params) as any)
            const result = { lastInsertRowid: rows?.[0]?.id ?? null, changes: rows?.length ?? 0 }
            logger.debug('db', `SQL ${op} ${table} OK`, { op, table, costMs: Date.now() - t0, changes: result.changes })
            return result
          } catch (err) {
            logger.error('db', `SQL ${op} ${table} FAILED`, { op, table, error: (err as Error).message, costMs: Date.now() - t0, sql: pgSql })
            throw err
          }
        },
        async get<T = unknown>(...params: unknown[]) {
          const t0 = Date.now()
          try {
            const rows: any[] = await client.unsafe(pgSql, coerceParams(params) as any)
            logger.debug('db', `SQL ${op} ${table} OK`, { op, table, costMs: Date.now() - t0 })
            return rows?.[0] as T | undefined
          } catch (err) {
            logger.error('db', `SQL ${op} ${table} FAILED`, { op, table, error: (err as Error).message, costMs: Date.now() - t0, sql: pgSql })
            throw err
          }
        },
        async all<T = unknown>(...params: unknown[]) {
          const t0 = Date.now()
          try {
            const rows = await client.unsafe(pgSql, coerceParams(params) as any)
            logger.debug('db', `SQL ${op} ${table} OK`, { op, table, costMs: Date.now() - t0, rowCount: rows.length })
            return rows as unknown as T[]
          } catch (err) {
            logger.error('db', `SQL ${op} ${table} FAILED`, { op, table, error: (err as Error).message, costMs: Date.now() - t0, sql: pgSql })
            throw err
          }
        },
      }
    },
    async exec(sql: string) {
      const t0 = Date.now()
      try {
        const result = await client.unsafe(prepareForPg(sql))
        logger.debug('db', `SQL EXEC OK`, { costMs: Date.now() - t0 })
        return result
      } catch (err) {
        logger.error('db', `SQL EXEC FAILED`, { error: (err as Error).message, costMs: Date.now() - t0, sql })
        throw err
      }
    },
    transaction<T>(fn: () => T | Promise<T>) {
      return async () => {
        if (!client) throw new Error('PG client not available')
        const t0 = Date.now()
        try {
          const result = await client.begin(async () => fn()) as T
          logger.debug('db', `TRANSACTION OK`, { costMs: Date.now() - t0 })
          return result
        } catch (err) {
          logger.error('db', `TRANSACTION FAILED`, { error: (err as Error).message, costMs: Date.now() - t0 })
          throw err
        }
      }
    },
    rawClient: client,
  }
}

// ─────────────────────────────────────────────
// PostgreSQL 初始化
// ─────────────────────────────────────────────
import pg from 'postgres'

let pgClient: ReturnType<typeof pg> | null = null
let pgDb: AsyncDb | null = null

const initPostgres = () => {
  const url = process.env.DATABASE_URL || 'postgresql://ai_study:123456@localhost:5432/ai_study'
  pgClient = pg(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  })
  pgDb = wrapPostgresAsAsync(pgClient)
}

// ─────────────────────────────────────────────
// 公共导出
// ─────────────────────────────────────────────

let sqliteWrapped: AsyncDb | null = null

export const initDatabase = () => {
  // 延迟 import 避免循环依赖（services/logger 间接依赖 db）
  import('../services/logger.js').then(({ logger }) => {
    if (DRIVER === 'postgres') {
      logger.info('db', '数据库初始化完成', { driver: 'PostgreSQL' })
    } else {
      logger.info('db', '数据库初始化完成', { driver: 'SQLite (default)' })
    }
  })

  if (DRIVER === 'postgres') {
    initPostgres()
  } else {
    initSqlite()
    sqliteWrapped = wrapSqliteAsAsync(sqliteDb!)
  }
}

/**
 * 获取 async 数据库实例
 * 两套驱动统一返回 AsyncDb，所有 prepare().run/get/all 都返回 Promise。
 * 上层调用：await db.prepare(sql).run(...)
 */
export const getDb = (): AsyncDb => {
  if (DRIVER === 'postgres') {
    if (!pgDb) throw new Error('PostgreSQL not initialized. Call initDatabase() first.')
    return pgDb
  }
  if (!sqliteWrapped) throw new Error('SQLite not initialized. Call initDatabase() first.')
  return sqliteWrapped
}

export const getDriver = () => DRIVER as 'sqlite' | 'postgres'

/**
 * 获取 PG 原生客户端（用于 pgvector 特有操作）
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
    pgDb = null
  }
}
