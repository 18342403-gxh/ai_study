/**
 * Drizzle ORM Schema — PostgreSQL + pgvector
 *
 * 分为两个 schema：
 *   app  — 业务表（文档、分块、会话、消息）
 *   public — drizzle 迁移追踪表（自动管理）
 *
 * 命名规范：snake_case、所有表带 created_at/updated_at、JSONB 弹性字段、UUID 主键
 */

import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  real,
  doublePrecision,
  jsonb,
  timestamp,
  vector,
  check,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ── app schema ──
export const app = pgSchema('app')

// ─────────────────────────────────────────
// 1. documents — RAG 知识库文档
// ─────────────────────────────────────────
export const documents = app.table(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 512 }).notNull(),
    size: integer('size').notNull(),
    mimeType: varchar('mime_type', { length: 128 }),
    storagePath: varchar('storage_path', { length: 1024 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('processing'),
    chunkCount: integer('chunk_count').default(0),
    userId: varchar('user_id', { length: 64 }).notNull().default('local'),
    libraryId: varchar('library_id', { length: 64 }).notNull().default('default'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check(
      'documents_status_check',
      sql`${t.status} IN ('processing','ready','failed','deleted')`,
    ),
    sizeCheck: check('documents_size_check', sql`${t.size} >= 0`),
    idxStatus: index('idx_documents_status').on(t.status),
    idxCreatedAt: index('idx_documents_created_at').on(t.createdAt),
  }),
)

// ─────────────────────────────────────────
// 2. chunks — 文档分块 + pgvector 向量
// ─────────────────────────────────────────
export const chunks = app.table(
  'chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    docId: uuid('doc_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    /** pgvector: 1536 维 embedding（兼容智谱 embedding-3） */
    embedding: vector('embedding', { dimensions: 1536 }),
    /** 向量血缘：real=真实 API，hash=降级伪向量 */
    embeddingType: varchar('embedding_type', { length: 16 }).notNull().default('real'),
    /** 生成该向量的模型名 */
    embeddingModel: varchar('embedding_model', { length: 64 }).notNull().default('embedding-3'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 抽取标记：null 表示尚未抽取过（v5 4.3.8） */
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
  },
  (t) => ({
    docFk: foreignKey({ columns: [t.docId], foreignColumns: [documents.id] }).onDelete('cascade'),
    idxDocId: index('idx_chunks_doc_id').on(t.docId),
  }),
)

// ─────────────────────────────────────────
// 3. sessions — 对话会话
// ─────────────────────────────────────────
export const sessions = app.table('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: varchar('user_id', { length: 64 }).notNull().default('local'),
  title: varchar('title', { length: 256 }).notNull().default('新对话'),
  model: varchar('model', { length: 64 }).notNull().default('glm-4-flash'),
  systemPrompt: text('system_prompt'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

// ─────────────────────────────────────────
// 4. messages — 会话消息历史
// ─────────────────────────────────────────
export const messages = app.table(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id').notNull(),
    role: varchar('role', { length: 16 }).notNull(),
    content: text('content').notNull(),
    toolCallId: varchar('tool_call_id', { length: 128 }),
    citations: jsonb('citations').$type<Record<string, unknown>[]>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionFk: foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id] }).onDelete(
      'cascade',
    ),
    roleCheck: check('messages_role_check', sql`${t.role} IN ('user','assistant','system','tool')`),
    idxSessionCreated: index('idx_messages_session_id_created_at').on(t.sessionId, t.createdAt),
  }),
)

// ─────────────────────────────────────────
// 5. entries — 个人记忆条目（v5 核心）
// ─────────────────────────────────────────
export const entries = app.table(
  'entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 64 }).notNull().default('local'),
    libraryId: varchar('library_id', { length: 64 }).notNull().default('default'),
    type: varchar('type', { length: 16 }).notNull(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    /** RRULE 子集：{ freq, interval?, byWeekday?, byMonthDay?, until? }，null 表示单次事件 */
    recurrence: jsonb('recurrence').$type<Record<string, unknown>>(),
    recurrenceUntil: timestamp('recurrence_until', { withTimezone: true }),
    /** 预留：例外实例，本期不使用 */
    exceptions: jsonb('exceptions').$type<Record<string, unknown>>(),
    sourceType: varchar('source_type', { length: 16 }).notNull().default('conversation'),
    /** 会话 id 或文档 id */
    sourceRef: text('source_ref'),
    confidence: real('confidence').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    typeCheck: check('entries_type_check', sql`${t.type} IN ('schedule','plan','fact','note')`),
    statusCheck: check(
      'entries_status_check',
      sql`${t.status} IN ('draft','active','done','archived')`,
    ),
    sourceTypeCheck: check(
      'entries_source_type_check',
      sql`${t.sourceType} IN ('conversation','document','manual')`,
    ),
    idxStatusType: index('idx_entries_status_type').on(t.status, t.type),
    idxStart: index('idx_entries_start').on(t.startAt),
    idxLibrary: index('idx_entries_library').on(t.libraryId, t.status),
  }),
)

// ─────────────────────────────────────────
// 6. entry_embeddings — 条目向量
// ─────────────────────────────────────────
export const entryEmbeddings = app.table(
  'entry_embeddings',
  {
    entryId: uuid('entry_id').primaryKey(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    /** 向量血缘：real=真实 API，hash=降级伪向量 */
    embeddingType: varchar('embedding_type', { length: 16 }).notNull().default('real'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entryFk: foreignKey({ columns: [t.entryId], foreignColumns: [entries.id] }).onDelete('cascade'),
  }),
)

// ─────────────────────────────────────────
// 7. ai_usage_logs — AI Token 用量日志（成本控制核心）
// ─────────────────────────────────────────
export const aiUsageLogs = app.table(
  'ai_usage_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    feature: varchar('feature', { length: 32 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull().default('zhipu'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costMs: integer('cost_ms').notNull().default(0),
    cost: doublePrecision('cost'),
    userId: varchar('user_id', { length: 64 }),
    sessionId: varchar('session_id', { length: 64 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    featureCheck: check(
      'ai_usage_logs_feature_check',
      sql`${t.feature} IN ('chat_general','chat_with_records','extract','understand','embedding','eval')`,
    ),
    idxCreated: index('idx_ai_usage_logs_created').on(t.createdAt),
    idxFeature: index('idx_ai_usage_logs_feature').on(t.feature, t.createdAt),
  }),
)

// ─────────────────────────────────────────
// 8. plans — 长期规划（目标 / 阶段 / 进度）
// ─────────────────────────────────────────
export const plans = app.table(
  'plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 64 }).notNull().default('local'),
    libraryId: varchar('library_id', { length: 64 }).notNull().default('default'),
    title: text('title').notNull(),
    /** 规划目标与背景 */
    goal: text('goal').notNull().default(''),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    progress: integer('progress').notNull().default(0),
    /** 阶段/里程碑：[{ title, description?, targetAt?, done? }] */
    stages: jsonb('stages').$type<
      Array<{
        id?: string
        title: string
        description?: string
        targetAt?: number | null
        done?: boolean
      }>
    >(),
    sourceType: varchar('source_type', { length: 16 }).notNull().default('manual'),
    sourceRef: text('source_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check(
      'plans_status_check',
      sql`${t.status} IN ('draft','active','done','archived')`,
    ),
    sourceTypeCheck: check(
      'plans_source_type_check',
      sql`${t.sourceType} IN ('conversation','document','manual')`,
    ),
    progressCheck: check('plans_progress_check', sql`${t.progress} BETWEEN 0 AND 100`),
    idxStatus: index('idx_plans_status').on(t.status),
    idxLibrary: index('idx_plans_library').on(t.libraryId, t.status),
    idxStart: index('idx_plans_start').on(t.startAt),
  }),
)

// ─────────────────────────────────────────
// 9. users — 超管 / 临时账号
// ─────────────────────────────────────────
export const users = app.table(
  'users',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    username: varchar('username', { length: 64 }).notNull().unique(),
    /** scrypt 哈希，格式 salt:hash */
    passwordHash: text('password_hash').notNull(),
    role: varchar('role', { length: 16 }).notNull().default('temp'),
    /** 知识库 id：超管 default，临时账号与自身 id 相同 */
    libraryId: varchar('library_id', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    /** 临时账号到期时间；超管为 null */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 64 }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roleCheck: check('users_role_check', sql`${t.role} IN ('admin','temp')`),
    statusCheck: check('users_status_check', sql`${t.status} IN ('active','deleted')`),
    idxRoleStatus: index('idx_users_role_status').on(t.role, t.status),
  }),
)

// ─────────────────────────────────────────
// 10. auth_sessions — 登录态（Cookie token 哈希）
// ─────────────────────────────────────────
export const authSessions = app.table(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userFk: foreignKey({ columns: [t.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    idxUser: index('idx_auth_sessions_user').on(t.userId),
    idxExpires: index('idx_auth_sessions_expires').on(t.expiresAt),
  }),
)
