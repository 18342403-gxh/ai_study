/**
 * 清空知识库调试脚本
 *
 * 用途：调试时一键清空所有知识库数据（条目 / 文档 / 向量 / 对话），
 *       默认保留 ai_usage_logs 成本记录。
 *
 * 运行（在 apps/server 目录下）：
 *   # 仅预览各表当前行数，不执行删除（dry-run，默认）
 *   npx tsx scripts/clear-knowledge.mts
 *
 *   # 真正清空知识库（保留 ai_usage_logs）
 *   npx tsx scripts/clear-knowledge.mts --yes
 *
 *   # 连 ai_usage_logs 一起清空
 *   npx tsx scripts/clear-knowledge.mts --yes --include-logs
 *
 *   # 指定数据库路径
 *   npx tsx scripts/clear-knowledge.mts --yes --db ./data/knowledge.db
 *
 * 说明：
 *   - 直接用 better-sqlite3 操作，不经过 drizzle，轻量无副作用
 *   - 不带 --yes 时只预览，防止误操作
 *   - chunks_vec 是 sqlite-vec 虚拟表，若存在则一并清空
 *   - ai_usage_logs 除非 --include-logs，否则保留（成本记录对调试有价值）
 */

import 'dotenv/config'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// ─── 参数解析 ────────────────────────────────────────────────
const args = process.argv.slice(2)
const yes = args.includes('--yes') || args.includes('-y')
const includeLogs = args.includes('--include-logs')
const dbIdx = args.indexOf('--db')
const dbPathArg = dbIdx >= 0 ? args[dbIdx + 1] : undefined

// ─── 数据库路径 ─────────────────────────────────────────────
const defaultDbPath = path.join(process.cwd(), 'data', 'knowledge.db')
const dbPath = dbPathArg || process.env.DB_PATH || defaultDbPath

if (!fs.existsSync(dbPath)) {
  console.error(`❌ 数据库文件不存在：${dbPath}`)
  console.error('   可用 --db <path> 指定路径，或检查 DB_PATH 环境变量。')
  process.exit(1)
}

// ─── 需要清空的表（知识库相关） ────────────────────────────
// 顺序：先子表后父表，避免外键约束报错（虽然开了 CASCADE，显式删更清晰）
const KNOWLEDGE_TABLES = [
  'messages', // 对话消息
  'entry_embeddings', // 条目向量
  'entries', // 个人记忆条目
  'chunks_vec', // 文档块向量（sqlite-vec 虚拟表，可能不存在）
  'chunks', // 文档块
  'documents', // 文档
  'sessions', // 会话
]

// ─── 连接数据库 ─────────────────────────────────────────────
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ─── 工具函数 ────────────────────────────────────────────────
/** 判断表是否存在（含虚拟表） */
const tableExists = (name: string): boolean => {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?
       UNION ALL
       SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(name, name) as { name?: string } | undefined
  return !!row?.name
}

/** 统计行数 */
const countRows = (name: string): number => {
  if (!tableExists(name)) return -1
  const row = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }
  return row.c
}

// ─── 预览模式 ────────────────────────────────────────────────
console.log(`\n🧹 清空知识库脚本`)
console.log(`   数据库：${dbPath}`)
console.log(`   模式：${yes ? '✅ 执行删除' : '👀 预览（dry-run，加 --yes 执行）'}`)
console.log(`   包含日志：${includeLogs ? '是（清空 ai_usage_logs）' : '否（保留 ai_usage_logs）'}`)
console.log('')

// 先打印各表当前行数
console.log('   各表当前行数：')
const tableCounts = new Map<string, number>()
for (const t of KNOWLEDGE_TABLES) {
  const count = countRows(t)
  tableCounts.set(t, count)
  const exists = count >= 0
  console.log(`     ${exists ? '✅' : '⬜️'}  ${t.padEnd(20)} ${exists ? count : '（表不存在，跳过）'}`)
}
if (includeLogs) {
  const c = countRows('ai_usage_logs')
  tableCounts.set('ai_usage_logs', c)
  console.log(`     ${c >= 0 ? '✅' : '⬜️'}  ${'ai_usage_logs'.padEnd(20)} ${c >= 0 ? c : '（表不存在，跳过）'}`)
}
console.log('')

if (!yes) {
  console.log('ℹ️  当前为预览模式，未执行任何删除。')
  console.log('   确认清空请运行：npx tsx scripts/clear-knowledge.mts --yes')
  db.close()
  process.exit(0)
}

// ─── 执行删除 ────────────────────────────────────────────────
const tx = db.transaction(() => {
  for (const t of KNOWLEDGE_TABLES) {
    if (!tableExists(t)) continue
    const before = tableCounts.get(t) ?? 0
    db.prepare(`DELETE FROM "${t}"`).run()
    console.log(`   🗑️  ${t.padEnd(20)} 删除 ${before} 行`)
  }
  if (includeLogs && tableExists('ai_usage_logs')) {
    const before = tableCounts.get('ai_usage_logs') ?? 0
    db.prepare(`DELETE FROM "ai_usage_logs"`).run()
    console.log(`   🗑️  ${'ai_usage_logs'.padEnd(20)} 删除 ${before} 行`)
  }
})

try {
  tx()
  console.log('\n✅ 知识库已清空。')

  // 验证：重新统计行数应为 0
  console.log('   验证（清空后行数）：')
  for (const t of KNOWLEDGE_TABLES) {
    if (!tableExists(t)) continue
    const after = countRows(t)
    console.log(`     ${after === 0 ? '✅' : '⚠️'}  ${t.padEnd(20)} ${after}`)
  }
  if (includeLogs && tableExists('ai_usage_logs')) {
    const after = countRows('ai_usage_logs')
    console.log(`     ${after === 0 ? '✅' : '⚠️'}  ${'ai_usage_logs'.padEnd(20)} ${after}`)
  }
  console.log('')
} catch (e) {
  console.error('\n❌ 清空失败：', (e as Error).message)
  db.close()
  process.exit(1)
}

db.close()
