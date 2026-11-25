import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required. Example: postgresql://ai_study:123456@localhost:5432/ai_study',
  )
  process.exit(1)
}

const sql = postgres(databaseUrl, { max: 1 })

try {
  const schemaSql = await readFile(new URL('./init-pg.sql', import.meta.url), 'utf8')
  await sql.unsafe(schemaSql, [], { prepare: false })
  await sql`SELECT 1`
  console.log('PostgreSQL schema and pgvector indexes initialized successfully.')
} catch (error) {
  console.error('Failed to initialize PostgreSQL:', error)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
