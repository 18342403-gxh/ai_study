/**
 * PostgreSQL 连接层（Drizzle ORM）
 *
 * 与 SQLite（index.ts）并存，通过 DATABASE_DRIVER 环境变量切换：
 *   DATABASE_DRIVER=sqlite  → 走 src/db/index.ts （默认，开发便捷）
 *   DATABASE_DRIVER=postgres → 走本文件 + pgvector
 *
 * 生产环境建议用 postgres。
 */

import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../drizzle/schema.js'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/ai_study'

let client: ReturnType<typeof postgres> | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null

/**
 * 获取 Drizzle 连接（单例）
 */
export const getPg = () => {
  if (!db) {
    client = postgres(DATABASE_URL, {
      max: 10,              // 连接池大小
      idle_timeout: 30,     // 空闲连接超时（秒）
      connect_timeout: 10,  // 连接超时（秒）
    })
    db = drizzle(client, { schema })
  }
  return db!
}

/**
 * 获取原始 postgres.js 客户端（用于原生 SQL、pgvector 操作等）
 */
export const getPgClient = () => {
  if (!client) getPg()
  return client!
}

/**
 * 关闭连接池（优雅关停用）
 */
export const closePg = async () => {
  if (client) {
    await client.end({ timeout: 5 })
    client = null
    db = null
  }
}

/**
 * 健康检查
 */
export const checkPg = async (): Promise<boolean> => {
  try {
    const c = getPgClient()
    const result = await c.unsafe('SELECT 1 as ok')
    return result.count === 1
  } catch {
    return false
  }
}

/**
 * pgvector 相似度检索（原生 SQL，Drizzle 的 vector 支持还在迭代中）
 *
 * 用法：
 *   const rows = await vectorSearch({
 *     embedding: queryVector,   // number[] 1536 维
 *     limit: 5,
 *     minScore: 0.6,
 *   })
 */
export interface VectorSearchOptions {
  embedding: number[]
  limit?: number
  minScore?: number
  docId?: string
}

export const vectorSearch = async (opts: VectorSearchOptions) => {
  const c = getPgClient()
  const limit = opts.limit ?? 5
  const minScore = opts.minScore ?? 0.5

  let sql = `
    SELECT c.id, c.doc_id, c.content, c.chunk_index,
           1 - (c.embedding <=> $1::vector) as similarity
    FROM app.chunks c
    WHERE c.embedding IS NOT NULL
  `
  const params: any[] = [`[${opts.embedding.join(',')}]`]

  if (opts.docId) {
    sql += ` AND c.doc_id = $${params.length + 1}`
    params.push(opts.docId)
  }

  sql += `
    AND (1 - (c.embedding <=> $1::vector)) >= $${params.length + 1}
    ORDER BY c.embedding <=> $1::vector
    LIMIT $${params.length + 2}
  `
  params.push(minScore, limit)

  return await c.unsafe(sql, params as any)
}
