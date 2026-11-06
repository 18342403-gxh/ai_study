/**
 * Drizzle 数据访问层冒烟测试（零依赖，node scripts/test-db-wrap.mjs 直接跑）
 *
 * 覆盖：
 *   1. SQLite（better-sqlite3 :memory:）— entries 真实 CRUD + entry_embeddings 级联删除
 *   2. PostgreSQL（postgres.js lazy 不连接）— .toSQL() 验证生成 SQL：
 *      app. schema 前缀 + $N 占位符
 */

import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { pgSchema, uuid, varchar, text as pgText, real as pgReal, timestamp } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'
import pg from 'postgres'

// ─── 与 drizzle/schema.sqlite.ts 同形状的最小表定义（独立可测） ───

const entries = sqliteTable('entries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().default('local'),
  libraryId: text('library_id').notNull().default('default'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  status: text('status').notNull().default('draft'),
  startAt: integer('start_at', { mode: 'timestamp_ms' }),
  confidence: real('confidence').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

const entryEmbeddings = sqliteTable('entry_embeddings', {
  entryId: text('entry_id')
    .primaryKey()
    .references(() => entries.id, { onDelete: 'cascade' }),
  embedding: text('embedding').notNull(),
  model: text('model').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// ─── 与 drizzle/schema.ts 同形状的最小 PG 表定义（app schema） ───

const app = pgSchema('app')
const pgEntries = app.table('entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: varchar('user_id', { length: 64 }).notNull().default('local'),
  type: varchar('type', { length: 32 }).notNull(),
  title: pgText('title').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('draft'),
  confidence: pgReal('confidence').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
})

// ─── 测试框架（极简，零依赖） ───

let passed = 0, failed = 0
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++ }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++ }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || ''}\n    got:      ${actual}\n    expected: ${expected}`)
}

// ═══ 1. SQLite :memory: 真实 CRUD ═══

console.log('\n📦 SQLite（better-sqlite3 :memory: + drizzle）')

const sqlite = new Database(':memory:')
sqlite.pragma('foreign_keys = ON')
sqlite.exec(`
  CREATE TABLE entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    library_id TEXT NOT NULL DEFAULT 'default',
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    start_at INTEGER,
    confidence REAL NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE entry_embeddings (
    entry_id TEXT PRIMARY KEY,
    embedding TEXT NOT NULL,
    model TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
  );
`)
const db = drizzleSqlite(sqlite, { schema: { entries, entryEmbeddings } })

const now = new Date()

await test('INSERT entries', async () => {
  await db.insert(entries).values({
    id: 'e1', type: 'note', title: '第一条', status: 'active',
    startAt: now, createdAt: now, updatedAt: now,
  })
  const rows = await db.select().from(entries).where(eq(entries.id, 'e1')).limit(1)
  assert(rows[0], '应能查到刚插入的行')
  assertEqual(rows[0].title, '第一条', 'title 应一致')
})

await test('timestamp_ms 模式自动 Date ↔ ms 互转', async () => {
  const rows = await db.select().from(entries).where(eq(entries.id, 'e1')).limit(1)
  assert(rows[0].startAt instanceof Date, 'startAt 应映射为 Date')
  assertEqual(rows[0].startAt.getTime(), now.getTime(), '毫秒时间戳应一致')
})

await test('UPDATE entries', async () => {
  await db.update(entries).set({ status: 'done', updatedAt: new Date() }).where(eq(entries.id, 'e1'))
  const rows = await db.select().from(entries).where(eq(entries.id, 'e1')).limit(1)
  assertEqual(rows[0].status, 'done', 'status 应更新为 done')
})

await test('INSERT entry_embeddings + 级联删除', async () => {
  await db.insert(entryEmbeddings).values({
    entryId: 'e1', embedding: '[0.1,0.2]', model: 'test', updatedAt: new Date(),
  })
  let emb = await db.select().from(entryEmbeddings).where(eq(entryEmbeddings.entryId, 'e1'))
  assertEqual(emb.length, 1, '向量应已写入')

  await db.delete(entries).where(eq(entries.id, 'e1'))
  emb = await db.select().from(entryEmbeddings).where(eq(entryEmbeddings.entryId, 'e1'))
  assertEqual(emb.length, 0, '删 entries 后向量应被级联删除')
})

sqlite.close()

// ═══ 2. PostgreSQL .toSQL() 离线验证（不建立连接） ═══

console.log('\n📦 PostgreSQL（postgres.js lazy + drizzle .toSQL()）')

// postgres() 惰性创建，不发起网络连接；.toSQL() 纯本地生成
const client = pg('postgres://user:pass@localhost:5432/db', { max: 1 })
const pgDb = drizzlePg(client, { schema: { pgEntries } })

await test('SELECT 生成 app. 前缀 + $1 占位符', async () => {
  const { sql, params } = pgDb
    .select()
    .from(pgEntries)
    .where(eq(pgEntries.id, 'abc-123'))
    .limit(1)
    .toSQL()
  assert(sql.includes('from "app"."entries"'), `FROM 应带 app. schema 前缀\n    got: ${sql}`)
  assert(sql.includes('$1'), `WHERE 应使用 $1 占位符\n    got: ${sql}`)
  assertEqual(params[0], 'abc-123', '参数应按序绑定')
})

await test('INSERT 生成 app. 前缀 + $N 占位符', async () => {
  const { sql, params } = pgDb
    .insert(pgEntries)
    .values({ type: 'note', title: 't', status: 'active' })
    .toSQL()
  assert(sql.includes('into "app"."entries"'), `INSERT 应带 app. schema 前缀\n    got: ${sql}`)
  assert(sql.includes('$1') && sql.includes('$3'), `VALUES 应使用 $N 占位符\n    got: ${sql}`)
  assert(params.includes('note') && params.includes('active'), '参数应包含 values')
})

await test('UPDATE / DELETE 生成 app. 前缀', async () => {
  const upd = pgDb.update(pgEntries).set({ status: 'done' }).where(eq(pgEntries.id, 'x')).toSQL()
  assert(upd.sql.includes('update "app"."entries"'), `UPDATE 应带 app. 前缀\n    got: ${upd.sql}`)
  const del = pgDb.delete(pgEntries).where(eq(pgEntries.id, 'x')).toSQL()
  assert(del.sql.includes('delete from "app"."entries"'), `DELETE 应带 app. 前缀\n    got: ${del.sql}`)
})

await client.end({ timeout: 0 }).catch(() => {})

// ─── 汇总 ───

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
