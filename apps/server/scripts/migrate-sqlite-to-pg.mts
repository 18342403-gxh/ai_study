import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import postgres from 'postgres'

type SqliteRow = Record<string, unknown>
type Tx = Parameters<Parameters<ReturnType<typeof postgres>['begin']>[0]>[0]

interface TableMigration {
  table: string
  columns: string[]
  map: (row: SqliteRow) => SqliteRow
}

const BUSINESS_TABLES = [
  'documents',
  'chunks',
  'sessions',
  'messages',
  'entries',
  'entry_embeddings',
  'plans',
  'ai_usage_logs',
] as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const fail = (message: string): never => {
  throw new Error(message)
}

const uuid = (value: unknown, table: string, column: string): string => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    fail(`Invalid UUID in ${table}.${column}: ${String(value)}`)
  }
  return value
}

const date = (value: unknown, table: string, id: string, column: string, required = false) => {
  if (value === null || value === undefined) {
    if (required) fail(`Missing timestamp in ${table}.${column}, id=${id}`)
    return null
  }
  const milliseconds = Number(value)
  if (!Number.isFinite(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) {
    fail(`Invalid millisecond timestamp in ${table}.${column}, id=${id}: ${String(value)}`)
  }
  return new Date(milliseconds)
}

const json = (value: unknown, table: string, id: string, column: string): unknown => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return fail(`Invalid JSON in ${table}.${column}, id=${id}`)
  }
}

const embedding = (value: unknown, table: string, id: string, nullable: boolean): string | null => {
  if (value === null || value === undefined) {
    if (!nullable) fail(`Missing embedding in ${table}, id=${id}`)
    return null
  }
  let parsed: unknown
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return fail(`Invalid embedding JSON in ${table}, id=${id}`)
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 1536 ||
    parsed.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    fail(`Embedding in ${table}, id=${id} must contain exactly 1536 finite numbers`)
  }
  return JSON.stringify(parsed)
}

const migrations: TableMigration[] = [
  {
    table: 'documents',
    columns: [
      'id',
      'name',
      'size',
      'mime_type',
      'storage_path',
      'status',
      'chunk_count',
      'user_id',
      'library_id',
      'metadata',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    map: (row) => {
      const id = uuid(row.id, 'documents', 'id')
      return {
        ...row,
        id,
        metadata: json(row.metadata, 'documents', id, 'metadata'),
        created_at: date(row.created_at, 'documents', id, 'created_at', true),
        updated_at: date(row.updated_at, 'documents', id, 'updated_at', true),
        deleted_at: date(row.deleted_at, 'documents', id, 'deleted_at'),
      }
    },
  },
  {
    table: 'chunks',
    columns: [
      'id',
      'doc_id',
      'chunk_index',
      'content',
      'token_count',
      'embedding',
      'embedding_type',
      'embedding_model',
      'created_at',
      'extracted_at',
    ],
    map: (row) => {
      const id = uuid(row.id, 'chunks', 'id')
      return {
        ...row,
        id,
        doc_id: uuid(row.doc_id, 'chunks', 'doc_id'),
        embedding: embedding(row.embedding, 'chunks', id, true),
        created_at: date(row.created_at, 'chunks', id, 'created_at', true),
        extracted_at: date(row.extracted_at, 'chunks', id, 'extracted_at'),
      }
    },
  },
  {
    table: 'sessions',
    columns: [
      'id',
      'title',
      'model',
      'system_prompt',
      'metadata',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    map: (row) => {
      const id = uuid(row.id, 'sessions', 'id')
      return {
        ...row,
        id,
        metadata: json(row.metadata, 'sessions', id, 'metadata'),
        created_at: date(row.created_at, 'sessions', id, 'created_at', true),
        updated_at: date(row.updated_at, 'sessions', id, 'updated_at', true),
        deleted_at: date(row.deleted_at, 'sessions', id, 'deleted_at'),
      }
    },
  },
  {
    table: 'messages',
    columns: [
      'id',
      'session_id',
      'role',
      'content',
      'tool_call_id',
      'citations',
      'metadata',
      'created_at',
    ],
    map: (row) => {
      const id = uuid(row.id, 'messages', 'id')
      return {
        ...row,
        id,
        session_id: uuid(row.session_id, 'messages', 'session_id'),
        citations: json(row.citations, 'messages', id, 'citations'),
        metadata: json(row.metadata, 'messages', id, 'metadata'),
        created_at: date(row.created_at, 'messages', id, 'created_at', true),
      }
    },
  },
  {
    table: 'entries',
    columns: [
      'id',
      'user_id',
      'library_id',
      'type',
      'title',
      'content',
      'status',
      'start_at',
      'end_at',
      'recurrence',
      'recurrence_until',
      'exceptions',
      'source_type',
      'source_ref',
      'confidence',
      'created_at',
      'updated_at',
      'archived_at',
    ],
    map: (row) => {
      const id = uuid(row.id, 'entries', 'id')
      return {
        ...row,
        id,
        recurrence: json(row.recurrence, 'entries', id, 'recurrence'),
        exceptions: json(row.exceptions, 'entries', id, 'exceptions'),
        start_at: date(row.start_at, 'entries', id, 'start_at'),
        end_at: date(row.end_at, 'entries', id, 'end_at'),
        recurrence_until: date(row.recurrence_until, 'entries', id, 'recurrence_until'),
        created_at: date(row.created_at, 'entries', id, 'created_at', true),
        updated_at: date(row.updated_at, 'entries', id, 'updated_at', true),
        archived_at: date(row.archived_at, 'entries', id, 'archived_at'),
      }
    },
  },
  {
    table: 'entry_embeddings',
    columns: ['entry_id', 'embedding', 'model', 'embedding_type', 'updated_at'],
    map: (row) => {
      const id = uuid(row.entry_id, 'entry_embeddings', 'entry_id')
      return {
        ...row,
        entry_id: id,
        embedding: embedding(row.embedding, 'entry_embeddings', id, false),
        updated_at: date(row.updated_at, 'entry_embeddings', id, 'updated_at', true),
      }
    },
  },
  {
    table: 'plans',
    columns: [
      'id',
      'user_id',
      'library_id',
      'title',
      'goal',
      'status',
      'start_at',
      'end_at',
      'progress',
      'stages',
      'source_type',
      'source_ref',
      'created_at',
      'updated_at',
      'archived_at',
    ],
    map: (row) => {
      const id = uuid(row.id, 'plans', 'id')
      return {
        ...row,
        id,
        stages: json(row.stages, 'plans', id, 'stages'),
        start_at: date(row.start_at, 'plans', id, 'start_at'),
        end_at: date(row.end_at, 'plans', id, 'end_at'),
        created_at: date(row.created_at, 'plans', id, 'created_at', true),
        updated_at: date(row.updated_at, 'plans', id, 'updated_at', true),
        archived_at: date(row.archived_at, 'plans', id, 'archived_at'),
      }
    },
  },
  {
    table: 'ai_usage_logs',
    columns: [
      'id',
      'feature',
      'model',
      'provider',
      'prompt_tokens',
      'completion_tokens',
      'total_tokens',
      'cost_ms',
      'cost',
      'user_id',
      'session_id',
      'metadata',
      'created_at',
    ],
    map: (row) => {
      const id = uuid(row.id, 'ai_usage_logs', 'id')
      return {
        ...row,
        id,
        metadata: json(row.metadata, 'ai_usage_logs', id, 'metadata'),
        created_at: date(row.created_at, 'ai_usage_logs', id, 'created_at', true),
      }
    },
  },
]

const parseSourcePath = (): string => {
  const args = process.argv.slice(2)
  const inline = args.find((arg) => arg.startsWith('--from='))
  const index = args.indexOf('--from')
  const value = inline?.slice('--from='.length) ?? (index >= 0 ? args[index + 1] : undefined)
  if (!value || value.startsWith('--')) {
    fail('Usage: pnpm --filter @ai-study/server migrate:sqlite -- --from ./data/knowledge.db')
  }
  return path.resolve(value)
}

const readRows = (source: Database.Database, table: string): SqliteRow[] => {
  const columns = source.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.length === 0) fail(`Source SQLite table is missing: ${table}`)
  return source.prepare(`SELECT * FROM ${table}`).all() as SqliteRow[]
}

const validateReferences = (rows: Map<string, SqliteRow[]>): void => {
  const checks = [
    { table: 'chunks', column: 'doc_id', parent: 'documents' },
    { table: 'messages', column: 'session_id', parent: 'sessions' },
    { table: 'entry_embeddings', column: 'entry_id', parent: 'entries' },
  ]
  for (const check of checks) {
    const parentIds = new Set(rows.get(check.parent)?.map((row) => String(row.id)))
    for (const row of rows.get(check.table) ?? []) {
      const parentId = String(row[check.column])
      if (!parentIds.has(parentId)) {
        fail(
          `Orphan row in ${check.table}, id=${String(row.id ?? row.entry_id)}: missing ${check.parent}.${parentId}`,
        )
      }
    }
  }
}

const insertBatch = async (tx: Tx, migration: TableMigration, rows: SqliteRow[]): Promise<void> => {
  if (rows.length === 0) return
  const params: unknown[] = []
  const tuples = rows.map((row) => {
    const values = migration.columns.map((column) => {
      params.push(row[column])
      const cast = column === 'embedding' ? '::vector(1536)' : ''
      return `$${params.length}${cast}`
    })
    return `(${values.join(', ')})`
  })
  await tx.unsafe(
    `INSERT INTO app.${migration.table} (${migration.columns.join(', ')}) VALUES ${tuples.join(', ')}`,
    params,
  )
}

const verifyKnn = async (tx: Tx, table: 'chunks' | 'entry_embeddings'): Promise<void> => {
  const samples = await tx.unsafe<{ embedding: string }[]>(
    `SELECT embedding::text AS embedding FROM app.${table} WHERE embedding IS NOT NULL LIMIT 1`,
  )
  const sample = samples[0]?.embedding
  if (!sample) return
  await tx.unsafe(
    `SELECT id FROM (SELECT ${table === 'chunks' ? 'id' : 'entry_id'} AS id, embedding FROM app.${table}) vectors
     WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector(1536) LIMIT 1`,
    [sample],
  )
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) fail('DATABASE_URL is required for migration')

const sourcePath = parseSourcePath()
await stat(sourcePath)
const sourceHash = createHash('sha256')
  .update(await readFile(sourcePath))
  .digest('hex')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = sourcePath.replace(/\.db$/i, '') + `.backup-${stamp}.db`
const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
const sql = postgres(databaseUrl, { max: 1 })

try {
  await source.backup(backupPath)
  console.log(`Source backup created: ${backupPath}`)

  const sourceRows = new Map<string, SqliteRow[]>()
  for (const table of BUSINESS_TABLES) sourceRows.set(table, readRows(source, table))
  validateReferences(sourceRows)

  let checkpointCount = 0
  try {
    checkpointCount = Number(
      (source.prepare('SELECT COUNT(*) AS count FROM checkpoints').get() as { count: number })
        .count,
    )
  } catch {
    // 没有旧检查点表时按 0 报告。
  }

  await sql.begin(async (tx) => {
    await tx.unsafe(
      `LOCK TABLE app.documents, app.chunks, app.sessions, app.messages, app.entries,
       app.entry_embeddings, app.plans, app.ai_usage_logs IN EXCLUSIVE MODE`,
    )
    const [extension] = await tx<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists
    `
    if (!extension?.exists) fail('pgvector extension is missing in the target database')

    for (const table of BUSINESS_TABLES) {
      const [row] = await tx.unsafe<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM app.${table}`,
      )
      if (Number(row?.count ?? 0) !== 0) {
        fail(`Target table app.${table} is not empty; migration refuses to overwrite or merge data`)
      }
    }

    for (const migration of migrations) {
      const rows = (sourceRows.get(migration.table) ?? []).map(migration.map)
      for (let offset = 0; offset < rows.length; offset += 100) {
        await insertBatch(tx, migration, rows.slice(offset, offset + 100))
      }
      console.log(`Imported ${migration.table}: ${rows.length} rows`)
    }

    for (const table of BUSINESS_TABLES) {
      const [target] = await tx.unsafe<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM app.${table}`,
      )
      const sourceCount = sourceRows.get(table)?.length ?? 0
      if (Number(target?.count) !== sourceCount) {
        fail(`Row count mismatch for ${table}: SQLite=${sourceCount}, PostgreSQL=${target?.count}`)
      }
    }

    const orphans = await tx.unsafe<{ count: string }[]>(`
      SELECT
        (SELECT COUNT(*) FROM app.chunks c LEFT JOIN app.documents d ON d.id = c.doc_id WHERE d.id IS NULL) +
        (SELECT COUNT(*) FROM app.messages m LEFT JOIN app.sessions s ON s.id = m.session_id WHERE s.id IS NULL) +
        (SELECT COUNT(*) FROM app.entry_embeddings e LEFT JOIN app.entries r ON r.id = e.entry_id WHERE r.id IS NULL)
        AS count
    `)
    if (Number(orphans[0]?.count) !== 0) fail('Foreign-key verification failed after migration')

    if ((sourceRows.get('chunks')?.length ?? 0) > 0) {
      await tx`SELECT c.id, d.id AS "docId" FROM app.chunks c JOIN app.documents d ON d.id = c.doc_id LIMIT 1`
    }
    if ((sourceRows.get('messages')?.length ?? 0) > 0) {
      await tx`SELECT m.id, s.id AS "sessionId" FROM app.messages m JOIN app.sessions s ON s.id = m.session_id LIMIT 1`
    }
    await tx`SELECT id, start_at, end_at, recurrence, exceptions FROM app.entries LIMIT 1`
    await tx`SELECT id, start_at, end_at, stages FROM app.plans LIMIT 1`
    await verifyKnn(tx, 'chunks')
    await verifyKnn(tx, 'entry_embeddings')

    const vectorCounts = await tx.unsafe<
      Array<{ table_name: string; total: string; non_null: string }>
    >(`
      SELECT 'chunks' AS table_name, COUNT(*)::text AS total, COUNT(embedding)::text AS non_null FROM app.chunks
      UNION ALL
      SELECT 'entry_embeddings', COUNT(*)::text, COUNT(embedding)::text FROM app.entry_embeddings
    `)
    console.log(`Legacy checkpoints (not converted): ${checkpointCount}`)
    console.log(`Vector counts: ${JSON.stringify(vectorCounts)}`)
  })

  const finalHash = createHash('sha256')
    .update(await readFile(sourcePath))
    .digest('hex')
  if (finalHash !== sourceHash) fail('Source SQLite file changed during migration')
  console.log(`Migration verified successfully. Source SHA-256 unchanged: ${sourceHash}`)
} catch (error) {
  console.error('SQLite to PostgreSQL migration failed:', error)
  process.exitCode = 1
} finally {
  source.close()
  await sql.end({ timeout: 5 })
}
