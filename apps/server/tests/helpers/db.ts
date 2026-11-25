import { closeCheckpointer } from '../../src/services/graph/checkpointer.js'
import { resetExtractGraph } from '../../src/services/extract/graph.js'
import { resetPlanGraph } from '../../src/services/plan/graph.js'
import { closeDatabase, getPgRaw, initDatabase } from '../../src/db/index.js'
import { assertTestDatabase, TEST_DATABASE_URL } from '../globalSetup.js'

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`

export const clearTestDatabase = async (): Promise<void> => {
  assertTestDatabase(process.env.DATABASE_URL ?? TEST_DATABASE_URL)
  const sql = getPgRaw()
  await sql.unsafe(`
    TRUNCATE TABLE app.entry_embeddings, app.entries, app.chunks, app.documents,
    app.messages, app.sessions, app.plans, app.ai_usage_logs CASCADE
  `)

  const checkpointTables = await sql<{ tableName: string }[]>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('checkpoints', 'checkpoint_blobs', 'checkpoint_writes', 'checkpoint_migrations')
  `
  if (checkpointTables.length > 0) {
    const tables = checkpointTables
      .map(({ tableName }) => `public.${quoteIdentifier(tableName)}`)
      .join(', ')
    await sql.unsafe(`TRUNCATE TABLE ${tables} CASCADE`)
  }
}

/** 每个 DB 用例前调用：重置单例、连接真实测试库并清空业务/检查点数据。 */
export const resetTestDatabase = async (): Promise<void> => {
  await closeCheckpointer()
  resetExtractGraph()
  resetPlanGraph()
  await closeDatabase()
  await initDatabase()
  await clearTestDatabase()
}

export const closeTestDatabase = async (): Promise<void> => {
  await closeCheckpointer()
  resetExtractGraph()
  resetPlanGraph()
  await closeDatabase()
}
