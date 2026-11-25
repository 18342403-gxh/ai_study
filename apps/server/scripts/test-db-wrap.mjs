import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://ai_study:123456@localhost:5432/ai_study_test'
const parsedUrl = new URL(connectionString)
const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1))
if (!databaseName.endsWith('_test')) {
  throw new Error(`Refusing to clean non-test database: ${databaseName || '(missing)'}`)
}

const adminUrl = new URL(connectionString)
adminUrl.pathname = '/postgres'
const admin = postgres(adminUrl.toString(), { max: 1 })
try {
  const existing = await admin`
    SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS exists
  `
  if (!existing[0]?.exists) await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
} finally {
  await admin.end({ timeout: 5 })
}

const sql = postgres(connectionString, { max: 1 })
let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  PASS ${name}`)
    passed++
  } catch (error) {
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
    failed++
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const entryId = randomUUID()
const now = new Date()
const vector = Array.from({ length: 1536 }, () => 0)
vector[0] = 1

try {
  const schemaSql = await readFile(new URL('./init-pg.sql', import.meta.url), 'utf8')
  await sql.unsafe(schemaSql, [], { prepare: false })
  await sql.unsafe(`
    TRUNCATE TABLE app.entry_embeddings, app.entries, app.chunks, app.documents,
    app.messages, app.sessions, app.plans, app.ai_usage_logs CASCADE
  `)

  await test('INSERT and SELECT timestamptz/jsonb', async () => {
    await sql`
      INSERT INTO app.entries (
        id, user_id, library_id, type, title, content, status, start_at,
        recurrence, source_type, confidence, created_at, updated_at
      ) VALUES (
        ${entryId}, 'local', 'db-wrap', 'note', '第一条', 'PostgreSQL CRUD', 'active', ${now},
        ${sql.json({ freq: 'DAILY', interval: 1 })}, 'manual', 1, ${now}, ${now}
      )
    `
    const rows = await sql`
      SELECT id, title, start_at, recurrence FROM app.entries WHERE id = ${entryId}
    `
    assert(rows.length === 1, 'inserted row should be readable')
    assert(rows[0].start_at instanceof Date, 'timestamptz should map to Date')
    assert(rows[0].start_at.getTime() === now.getTime(), 'timestamp milliseconds should round-trip')
    assert(rows[0].recurrence.freq === 'DAILY', 'jsonb should map to an object')
  })

  await test('UPDATE entry', async () => {
    await sql`UPDATE app.entries SET status = 'done', title = '已更新' WHERE id = ${entryId}`
    const rows = await sql`SELECT status, title FROM app.entries WHERE id = ${entryId}`
    assert(rows[0]?.status === 'done' && rows[0]?.title === '已更新', 'update should persist')
  })

  await test('pgvector cosine KNN', async () => {
    await sql`
      INSERT INTO app.entry_embeddings (entry_id, embedding, model, embedding_type, updated_at)
      VALUES (${entryId}, ${JSON.stringify(vector)}::vector(1536), 'test', 'real', ${now})
    `
    const rows = await sql`
      SELECT entry_id, embedding <=> ${JSON.stringify(vector)}::vector(1536) AS distance
      FROM app.entry_embeddings
      ORDER BY embedding <=> ${JSON.stringify(vector)}::vector(1536)
      LIMIT 1
    `
    assert(rows[0]?.entry_id === entryId, 'KNN should return the inserted vector')
    assert(Number(rows[0]?.distance) === 0, 'identical vectors should have zero cosine distance')
  })

  await test('DELETE cascades to entry_embeddings', async () => {
    await sql`DELETE FROM app.entries WHERE id = ${entryId}`
    const rows =
      await sql`SELECT COUNT(*) AS count FROM app.entry_embeddings WHERE entry_id = ${entryId}`
    assert(Number(rows[0]?.count) === 0, 'embedding should be cascade-deleted')
  })
} finally {
  await sql
    .unsafe(
      `
    TRUNCATE TABLE app.entry_embeddings, app.entries, app.chunks, app.documents,
    app.messages, app.sessions, app.plans, app.ai_usage_logs CASCADE
  `,
    )
    .catch(() => {})
  await sql.end({ timeout: 5 })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
