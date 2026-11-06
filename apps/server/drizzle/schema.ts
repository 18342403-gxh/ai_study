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
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
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
    // 注意：pgvector 类型需要在运行时注入，这里用 text 作为声明占位
    // 实际建表时会被 pgvector 扩展替换为 vector(1536)
    embedding: text('embedding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
