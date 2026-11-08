/**
 * OpenAPI 3.1 spec 生成器
 *
 * 从 Zod schema 自动生成 components.schemas，
 * paths 手工注册（Express Router 不暴露路由元数据）。
 *
 * 用法：
 *   import { openApiSpec } from './openapi/generate.js'
 *   app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec))
 */

import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

// ── 所有 Zod schema（与 routes 内定义保持同步） ────────

// -- sessions
const createSessionSchema = z.object({
  title: z.string().max(100).optional(),
  model: z.string().max(50).optional(),
  systemPrompt: z.string().optional(),
})
const updateSessionSchema = z.object({
  title: z.string().max(100).optional(),
  model: z.string().max(50).optional(),
  systemPrompt: z.string().nullable().optional(),
})
const addMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// -- rag
const urlImportSchema = z.object({
  url: z.string().trim().url(),
  name: z.string().trim().max(120).optional(),
})
const ragQuerySchema = z.object({
  query: z.string().min(1),
  documentIds: z.array(z.string()).optional(),
  topK: z.coerce.number().int().min(1).max(20).default(4),
  stream: z.boolean().default(true),
  systemPrompt: z.string().optional(),
})

// -- documents
const uploadMetadataSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
  })
  .optional()
const docIdParamSchema = z.object({ id: z.string().uuid() })

// -- entries
const entryTypeEnum = z.enum(['schedule', 'plan', 'fact', 'note'])
const entryStatusEnum = z.enum(['draft', 'active', 'done', 'archived'])
const recurrenceSchema = z.object({
  freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  interval: z.number().int().min(1).max(365).optional(),
  byWeekday: z
    .array(z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']))
    .max(7)
    .optional(),
  byMonthDay: z.number().int().min(1).max(31).optional(),
  until: z.number().int().optional(),
})
const createEntrySchema = z.object({
  type: entryTypeEnum,
  title: z.string().min(1).max(100),
  content: z.string().max(10000).default(''),
  status: entryStatusEnum.default('active'),
  startAt: z.number().int().nullable().optional(),
  endAt: z.number().int().nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  recurrenceUntil: z.number().int().nullable().optional(),
  sourceType: z.enum(['conversation', 'document', 'manual']).default('manual'),
  sourceRef: z.string().max(128).nullable().optional(),
  confidence: z.number().min(0).max(1).default(1),
  userId: z.string().max(64).default('local'),
  libraryId: z.string().max(64).default('default'),
})
const updateEntrySchema = createEntrySchema.partial().omit({ userId: true, sourceType: true })
const listEntriesQuerySchema = z.object({
  type: entryTypeEnum.optional(),
  status: entryStatusEnum.optional(),
  libraryId: z.string().max(64).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

// -- extract
const extractSchema = z.object({
  text: z.string().min(1).max(5000),
  sessionId: z.string().max(64).nullable().optional(),
  libraryId: z.string().max(64).default('default'),
})

const documentExtractSchema = z.object({
  chunkIds: z.array(z.string().min(1).max(64)).max(100).optional(),
  libraryId: z.string().max(64).default('default'),
})

// -- search
const searchSchema = z.object({
  query: z.string().min(1).max(500),
  libraryId: z.string().max(64).default('default'),
  timeRange: z
    .object({
      start: z.number().int(),
      end: z.number().int(),
    })
    .nullable()
    .optional(),
  includeArchived: z.boolean().default(false),
  skipUnderstanding: z.boolean().default(false),
})

// -- chat ask（v5 阶段 7）
const chatAskSchema = z.object({
  message: z.string().min(1).max(5000),
  sessionId: z.string().max(64).nullable().optional(),
  libraryId: z.string().max(64).default('default'),
})

// -- chat
const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
})
const chatCompletionsSchema = z.object({
  model: z.string().optional(),
  messages: z.array(chatMessageSchema),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
})

// -- cost
const daysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).optional(),
})

// -- logs
const listLogsQuerySchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  tag: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
})

// ── Schema → JSON Schema components ────────────────────

const ALL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  createSession: createSessionSchema,
  updateSession: updateSessionSchema,
  addMessage: addMessageSchema,
  urlImport: urlImportSchema,
  ragQuery: ragQuerySchema,
  uploadMetadata: uploadMetadataSchema,
  docIdParam: docIdParamSchema,
  recurrence: recurrenceSchema,
  createEntry: createEntrySchema,
  updateEntry: updateEntrySchema,
  listEntriesQuery: listEntriesQuerySchema,
  extractRequest: extractSchema,
  documentExtractRequest: documentExtractSchema,
  searchRequest: searchSchema,
  chatAskRequest: chatAskSchema,
  chatMessage: chatMessageSchema,
  chatCompletions: chatCompletionsSchema,
  daysQuery: daysQuerySchema,
  listLogsQuery: listLogsQuerySchema,
}

function buildComponents(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {}
  for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
    schemas[name] = zodToJsonSchema(schema as never, {
      name,
      target: 'openApi3',
    })
  }
  return { schemas }
}

// ── Paths 手工注册 ──────────────────────────────────────

interface PathItem {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  summary: string
  requestBody?: string // schema 名
  params?: string[] // {paramName: schemaName}
  query?: string
  responses?: Record<string, { description: string }>
}

const PATHS: Record<string, PathItem[]> = {
  '/api/health': [
    { method: 'get', summary: '健康检查', responses: { '200': { description: 'OK' } } },
  ],
  '/api/sessions': [
    { method: 'get', summary: '列出所有会话', responses: { '200': { description: '会话列表' } } },
    {
      method: 'post',
      summary: '创建会话',
      requestBody: 'createSession',
      responses: { '201': { description: '创建成功' } },
    },
  ],
  '/api/sessions/{id}': [
    {
      method: 'get',
      summary: '获取会话（含消息）',
      params: ['sessionId'],
      responses: { '200': { description: '会话详情' } },
    },
    {
      method: 'patch',
      summary: '更新会话标题/配置',
      params: ['sessionId'],
      requestBody: 'updateSession',
      responses: { '200': { description: '更新成功' } },
    },
    {
      method: 'delete',
      summary: '删除会话（级联消息）',
      params: ['sessionId'],
      responses: { '204': { description: '已删除' } },
    },
  ],
  '/api/sessions/{id}/messages': [
    {
      method: 'post',
      summary: '添加消息到会话',
      params: ['sessionId'],
      requestBody: 'addMessage',
      responses: { '201': { description: '添加成功' } },
    },
    {
      method: 'delete',
      summary: '清空会话消息',
      params: ['sessionId'],
      responses: { '204': { description: '已清空' } },
    },
  ],
  '/api/chat/completions': [
    {
      method: 'post',
      summary: 'Chat Completions（兼容 OpenAI 格式）',
      requestBody: 'chatCompletions',
      responses: { '200': { description: 'AI 回复' } },
    },
  ],
  '/api/rag/documents': [
    {
      method: 'post',
      summary: '上传文档入库（multipart/form-data）',
      responses: { '201': { description: '入库成功' } },
    },
    { method: 'get', summary: '列出已入库文档', responses: { '200': { description: '文档列表' } } },
  ],
  '/api/rag/documents/url': [
    {
      method: 'post',
      summary: 'URL 导入',
      requestBody: 'urlImport',
      responses: { '201': { description: '导入成功' } },
    },
  ],
  '/api/rag/documents/{id}': [
    {
      method: 'delete',
      summary: '删除文档及其向量',
      params: ['docId'],
      responses: { '204': { description: '已删除' } },
    },
  ],
  '/api/rag/query': [
    {
      method: 'post',
      summary: 'RAG 问答',
      requestBody: 'ragQuery',
      responses: { '200': { description: '检索+生成结果' } },
    },
  ],
  '/api/documents/upload': [
    {
      method: 'post',
      summary: '上传文档（旧接口，multipart + 可选 metadata）',
      responses: { '201': { description: '上传成功，后台处理中' } },
    },
  ],
  '/api/documents': [
    { method: 'get', summary: '列出文档', responses: { '200': { description: '文档列表' } } },
  ],
  '/api/entries': [
    {
      method: 'get',
      summary: '列出条目（?type=&status=&libraryId=&from=&to=&limit=）',
      responses: { '200': { description: '条目列表' } },
    },
    {
      method: 'post',
      summary: '新建条目（手动创建默认 active）',
      requestBody: 'createEntry',
      responses: { '201': { description: '创建成功' } },
    },
  ],
  '/api/entries/{id}': [
    {
      method: 'get',
      summary: '获取单条条目',
      params: ['entryId'],
      responses: { '200': { description: '条目详情' } },
    },
    {
      method: 'patch',
      summary: '更新条目（含状态流转：确认/完成/归档）',
      params: ['entryId'],
      requestBody: 'updateEntry',
      responses: { '200': { description: '更新成功' } },
    },
    {
      method: 'delete',
      summary: '永久删除条目（级联删除向量）',
      params: ['entryId'],
      responses: { '204': { description: '已删除' } },
    },
  ],
  '/api/extract': [
    {
      method: 'post',
      summary: '对话抽取：意图判别 + 结构化条目（含重复/冲突提示）',
      requestBody: 'extractRequest',
      responses: { '200': { description: '抽取结果（不写库）' } },
    },
  ],
  '/api/documents/{id}/extract': [
    {
      method: 'post',
      summary: '文档抽取为候选记录（整篇或指定块，单次最多 100 块）',
      requestBody: 'documentExtractRequest',
      responses: { '200': { description: '候选条目卡片（不写库）' } },
    },
  ],
  '/api/search': [
    {
      method: 'post',
      summary: '检索调试：时间通道 + 条目/文档语义通道，返回加权分与汇总',
      requestBody: 'searchRequest',
      responses: { '200': { description: '检索结果（只读）' } },
    },
  ],
  '/api/chat': [
    {
      method: 'post',
      summary: '个人知识问答：三路检索 + 强制引用回答，citations 快照入消息',
      requestBody: 'chatAskRequest',
      responses: { '200': { description: '回答 + citations + missing + degraded 标记' } },
    },
  ],
  '/api/reminders': [
    {
      method: 'get',
      summary: '简单提醒：返回今天与明天的日程/规划（重复事件已展开为实例）',
      responses: { '200': { description: '{ today: ReminderItem[], tomorrow: ReminderItem[] }' } },
    },
  ],
  '/api/documents/{id}': [
    {
      method: 'delete',
      summary: '删除文档',
      responses: { '204': { description: '已删除' } },
    },
  ],
  '/api/cost/today': [
    { method: 'get', summary: '今日用量速览', responses: { '200': { description: 'OK' } } },
  ],
  '/api/cost/daily': [
    {
      method: 'get',
      summary: '按天聚合（?days=1-30）',
      responses: { '200': { description: 'OK' } },
    },
  ],
  '/api/cost/breakdown': [
    {
      method: 'get',
      summary: '按 feature+model 拆解',
      responses: { '200': { description: 'OK' } },
    },
  ],
  '/api/cost/settings': [
    { method: 'get', summary: '预算等配置', responses: { '200': { description: 'OK' } } },
  ],
  '/api/logs': [
    {
      method: 'get',
      summary: '历史日志（?level=&tag=&limit=）',
      responses: { '200': { description: '日志列表' } },
    },
  ],
  '/api/logs/tags': [
    {
      method: 'get',
      summary: '所有出现过的 tag',
      responses: { '200': { description: 'tag 列表' } },
    },
  ],
  '/api/logs/stream': [
    { method: 'get', summary: 'SSE 实时日志流', responses: { '200': { description: 'SSE 流' } } },
  ],
  '/api/openapi.json': [
    {
      method: 'get',
      summary: '本 OpenAPI spec',
      responses: { '200': { description: 'OpenAPI 3.1 JSON' } },
    },
  ],
}

// ── 组装 OpenAPI spec ──────────────────────────────────

export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, unknown> = {}

  for (const [path, items] of Object.entries(PATHS)) {
    const pathItem: Record<string, unknown> = {}
    for (const item of items) {
      const op: Record<string, unknown> = {
        summary: item.summary,
        responses: item.responses ?? { '200': { description: 'OK' } },
      }

      if (item.requestBody) {
        op.requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${item.requestBody}` },
            },
          },
        }
      }

      if (item.params) {
        op.parameters = item.params.map((p) => ({
          name: p,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        }))
      }

      if (item.query) {
        op.parameters = [
          ...((op.parameters as unknown[]) ?? []),
          {
            name: 'query',
            in: 'query',
            schema: { $ref: `#/components/schemas/${item.query}` },
          },
        ]
      }

      pathItem[item.method] = op
    }
    paths[path] = pathItem
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'AI Study Server API',
      version: '0.4.0',
      description:
        'Node BFF 中间层 — Chat / RAG / Cost / Logs.\n\n所有接口带 `X-Request-Id` response header 用于链路追踪。',
    },
    servers: [{ url: 'http://localhost:3001', description: '本地开发' }],
    paths,
    components: buildComponents(),
    tags: [
      { name: 'Health', description: '健康检查' },
      { name: 'Sessions', description: '会话管理' },
      { name: 'Chat', description: 'Chat Completions' },
      { name: 'RAG', description: '检索增强生成' },
      { name: 'Documents', description: '文档管理（旧接口）' },
      { name: 'Entries', description: '个人条目（记忆）管理' },
      { name: 'Cost', description: '成本控制' },
      { name: 'Logs', description: '结构化日志' },
    ],
  }
}

// 单例，避免每次请求都重新序列化所有 schema
const _cached: Record<string, unknown> | null = null

export function getOpenApiSpec(): Record<string, unknown> {
  // 用模块级缓存 — buildOpenApiSpec 只在第一次 export 时执行
  return buildOpenApiSpec()
}
