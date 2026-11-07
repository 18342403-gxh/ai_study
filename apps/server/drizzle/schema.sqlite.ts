/**
 * Drizzle ORM Schema — SQLite 方言（better-sqlite3）
 *
 * 与 drizzle/schema.ts（PostgreSQL）一一对应：
 *   - 表名 / 列名（snake_case）完全一致
 *   - camelCase 属性名完全一致（统一数据访问层的前提）
 *   - 时间戳：integer({ mode: 'timestamp_ms' }) — Date ↔ 毫秒整数自动互转
 *   - JSON 列：text({ mode: 'json' }) — 对象 ↔ TEXT 自动序列化
 *   - 主键：text UUID（业务层 randomUUID() 生成，与 PG gen_random_uuid() 对齐形状）
 *
 * 差异说明：
 *   - messages.metadata 保持普通 text（业务手动 JSON.stringify，维持 string 透传行为）
 *   - SQLite 不支持部分索引（WHERE 子句），idx_entries_start 用普通索引替代
 */

import { sqliteTable, text, integer, real, index, check } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─────────────────────────────────────────
// 1. documents — RAG 知识库文档
// ─────────────────────────────────────────
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    mimeType: text('mime_type'),
    storagePath: text('storage_path').notNull().default(''),
    status: text('status').notNull().default('processing'),
    chunkCount: integer('chunk_count').default(0),
    userId: text('user_id').notNull().default('local'),
    libraryId: text('library_id').notNull().default('default'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('documents_status_check', sql`${t.status} IN ('processing','ready','failed','deleted')`),
    index('idx_documents_status').on(t.status),
    index('idx_documents_created_at').on(t.createdAt),
  ],
)

// ─────────────────────────────────────────
// 2. chunks — 文档分块 + 向量（JSON 文本存储）
// ─────────────────────────────────────────
export const chunks = sqliteTable(
  'chunks',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    tokenCount: integer('token_count'),
    embedding: text('embedding'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    /** 抽取标记：null 表示尚未抽取过（v5 4.3.8） */
    extractedAt: integer('extracted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('idx_chunks_doc_id').on(t.docId)],
)

// ─────────────────────────────────────────
// 3. sessions — 对话会话
// ─────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('新对话'),
  model: text('model').notNull().default('glm-4-flash'),
  systemPrompt: text('system_prompt'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
})

// ─────────────────────────────────────────
// 4. messages — 会话消息历史
// ─────────────────────────────────────────
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    toolCallId: text('tool_call_id'),
    citations: text('citations', { mode: 'json' }).$type<Record<string, unknown>[]>(),
    /** 普通 text：业务手动 JSON.stringify，保持 string 透传行为 */
    metadata: text('metadata'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check('messages_role_check', sql`${t.role} IN ('user','assistant','system','tool')`),
    index('idx_messages_session_id_created_at').on(t.sessionId, t.createdAt),
  ],
)

// ─────────────────────────────────────────
// 5. entries — 个人记忆条目（v5 核心）
// ─────────────────────────────────────────
export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().default('local'),
    libraryId: text('library_id').notNull().default('default'),
    type: text('type').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    status: text('status').notNull().default('draft'),
    startAt: integer('start_at', { mode: 'timestamp_ms' }),
    endAt: integer('end_at', { mode: 'timestamp_ms' }),
    /** RRULE 子集：{ freq, interval?, byWeekday?, byMonthDay?, until? }，null 表示单次事件 */
    recurrence: text('recurrence', { mode: 'json' }).$type<Record<string, unknown>>(),
    recurrenceUntil: integer('recurrence_until', { mode: 'timestamp_ms' }),
    /** 预留：例外实例，本期不使用 */
    exceptions: text('exceptions', { mode: 'json' }).$type<Record<string, unknown>>(),
    sourceType: text('source_type').notNull().default('conversation'),
    /** 会话 id 或文档 id */
    sourceRef: text('source_ref'),
    confidence: real('confidence').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('entries_type_check', sql`${t.type} IN ('schedule','plan','fact','note')`),
    check('entries_status_check', sql`${t.status} IN ('draft','active','done','archived')`),
    check(
      'entries_source_type_check',
      sql`${t.sourceType} IN ('conversation','document','manual')`,
    ),
    index('idx_entries_status_type').on(t.status, t.type),
    index('idx_entries_start').on(t.startAt),
    index('idx_entries_library').on(t.libraryId, t.status),
  ],
)

// ─────────────────────────────────────────
// 6. entry_embeddings — 条目向量
// ─────────────────────────────────────────
export const entryEmbeddings = sqliteTable('entry_embeddings', {
  entryId: text('entry_id')
    .primaryKey()
    .references(() => entries.id, { onDelete: 'cascade' }),
  embedding: text('embedding').notNull(),
  model: text('model').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// ─────────────────────────────────────────
// 7. ai_usage_logs — AI Token 用量日志（成本控制核心）
// ─────────────────────────────────────────
export const aiUsageLogs = sqliteTable(
  'ai_usage_logs',
  {
    id: text('id').primaryKey(),
    feature: text('feature').notNull(),
    model: text('model').notNull(),
    provider: text('provider').notNull().default('zhipu'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costMs: integer('cost_ms').notNull().default(0),
    userId: text('user_id'),
    sessionId: text('session_id'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check(
      'ai_usage_logs_feature_check',
      sql`${t.feature} IN ('chat','generator','rag','embedding','eval')`,
    ),
    index('idx_ai_usage_logs_created').on(t.createdAt),
    index('idx_ai_usage_logs_feature').on(t.feature, t.createdAt),
  ],
)
