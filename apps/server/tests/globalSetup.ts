import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://ai_study:123456@localhost:5432/ai_study_test'

export const assertTestDatabase = (connectionString: string): string => {
  const url = new URL(connectionString)
  const databaseName = decodeURIComponent(url.pathname.slice(1))
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to initialize or clean non-test database: ${databaseName || '(missing)'}`,
    )
  }
  return databaseName
}

export default async function globalSetup(): Promise<void> {
  const databaseName = assertTestDatabase(TEST_DATABASE_URL)
  const adminUrl = new URL(TEST_DATABASE_URL)
  adminUrl.pathname = '/postgres'
  const admin = postgres(adminUrl.toString(), { max: 1 })

  try {
    const existing = await admin<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS exists
    `
    if (!existing[0]?.exists) {
      await admin.unsafe(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`)
    }
  } finally {
    await admin.end({ timeout: 5 })
  }

  const sql = postgres(TEST_DATABASE_URL, { max: 1 })
  try {
    const schemaSql = await readFile(new URL('../scripts/init-pg.sql', import.meta.url), 'utf8')
    await sql.unsafe(schemaSql, [], { prepare: false })
    await sql.unsafe(`
      TRUNCATE TABLE app.entry_embeddings, app.entries, app.chunks, app.documents,
      app.messages, app.sessions, app.plans, app.ai_usage_logs CASCADE
    `)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
