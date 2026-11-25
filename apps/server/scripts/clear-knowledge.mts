/**
 * 清空知识库调试脚本（PostgreSQL）
 *
 * 默认仅预览；--yes 执行删除，--include-logs 同时清空费用日志。
 * 数据库通过必填的 DATABASE_URL 指定。
 */

import 'dotenv/config'
import postgres from 'postgres'

const args = process.argv.slice(2)
const yes = args.includes('--yes') || args.includes('-y')
const includeLogs = args.includes('--include-logs')
const knowledgeTables = [
  'messages',
  'entry_embeddings',
  'entries',
  'chunks',
  'documents',
  'sessions',
] as const
const tables = includeLogs ? [...knowledgeTables, 'ai_usage_logs'] : [...knowledgeTables]

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}

const sql = postgres(databaseUrl, { max: 1 })

try {
  await sql.unsafe('SET search_path TO app')
  const counts = new Map<string, number>()

  console.log(`清空知识库：${yes ? '执行删除' : '预览（加 --yes 执行）'}`)
  console.log(`费用日志：${includeLogs ? '一并清空' : '保留'}`)
  for (const table of tables) {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ${sql(table)}
    `
    const count = rows[0]?.count ?? 0
    counts.set(table, count)
    console.log(`  ${table.padEnd(20)} ${count}`)
  }

  if (!yes) {
    console.log('预览完成，未删除任何数据。')
  } else {
    await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL search_path TO app')
      for (const table of tables) {
        await tx`DELETE FROM ${tx(table)}`
        console.log(`  已删除 ${table}: ${counts.get(table) ?? 0} 行`)
      }
    })

    for (const table of tables) {
      const rows = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM ${sql(table)}
      `
      if (rows[0]?.count !== 0) throw new Error(`${table} 清空后仍有数据`)
    }
    console.log('知识库已清空并验证。')
  }
} catch (error) {
  console.error('清空知识库失败：', error)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
