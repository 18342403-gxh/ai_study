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

// -- tools
const executeSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  sessionId: z.string().optional(),
})
const runSchema = z.object({
  messages: z.array(chatMessageSchema),
  userInput: z.string().optional(),
  allowedToolIds: z.array(z.string()).optional(),
  maxIterations: z.coerce.number().int().min(1).max(20).default(5),
  systemPrompt: z.string().optional(),
  sessionId: z.string().optional(),
})

// -- agent
const agentInputSchema = z.object({
  requirement: z.string().min(1),
  model: z.string().optional(),
  sessionId: z.string().optional(),
})
const pauseSchema = z.object({ sessionId: z.string() })
const resumeSchema = z.object({ sessionId: z.string() })
const rollbackSchema = z.object({
  sessionId: z.string(),
  steps: z.coerce.number().int().min(1).default(1),
})

// -- generator
const generatorInputSchema = z.object({
  requirement: z.string().min(1),
  artifactType: z.enum(['ppt', 'doc', 'sheet', 'image']),
  model: z.string().optional(),
})
const generatorIterateSchema = z.object({
  stateId: z.string(),
  feedback: z.string(),
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
  chatMessage: chatMessageSchema,
  chatCompletions: chatCompletionsSchema,
  execute: executeSchema,
  run: runSchema,
  agentInput: agentInputSchema,
  pause: pauseSchema,
  resume: resumeSchema,
  rollback: rollbackSchema,
  generatorInput: generatorInputSchema,
  generatorIterate: generatorIterateSchema,
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
  '/api/documents/{id}': [
    {
      method: 'delete',
      summary: '删除文档',
      responses: { '204': { description: '已删除' } },
    },
  ],
  '/api/tools/list': [
    { method: 'get', summary: '可用工具列表', responses: { '200': { description: '工具列表' } } },
  ],
  '/api/tools/execute': [
    {
      method: 'post',
      summary: '直接执行指定工具',
      requestBody: 'execute',
      responses: { '200': { description: '执行结果' } },
    },
  ],
  '/api/tools/run': [
    {
      method: 'post',
      summary: 'Function Calling 循环（流式）',
      requestBody: 'run',
      responses: { '200': { description: '执行流' } },
    },
  ],
  '/api/agent/start': [
    {
      method: 'post',
      summary: '启动 Agent 任务',
      requestBody: 'agentInput',
      responses: { '201': { description: '任务已启动' } },
    },
  ],
  '/api/agent/pause': [
    {
      method: 'post',
      summary: '暂停 Agent',
      requestBody: 'pause',
      responses: { '200': { description: '已暂停' } },
    },
  ],
  '/api/agent/resume': [
    {
      method: 'post',
      summary: '恢复 Agent',
      requestBody: 'resume',
      responses: { '200': { description: '已恢复' } },
    },
  ],
  '/api/agent/rollback': [
    {
      method: 'post',
      summary: 'Agent 回退 N 步',
      requestBody: 'rollback',
      responses: { '200': { description: '已回退' } },
    },
  ],
  '/api/generator/start': [
    {
      method: 'post',
      summary: '启动文档生成',
      requestBody: 'generatorInput',
      responses: { '201': { description: '生成器已启动' } },
    },
  ],
  '/api/generator/iterate': [
    {
      method: 'post',
      summary: '迭代生成（反馈优化）',
      requestBody: 'generatorIterate',
      responses: { '200': { description: '迭代完成' } },
    },
  ],
  '/api/generator/state/{id}': [
    {
      method: 'get',
      summary: '查询生成状态',
      params: ['stateId'],
      responses: { '200': { description: '状态详情' } },
    },
    {
      method: 'delete',
      summary: '取消生成',
      params: ['stateId'],
      responses: { '204': { description: '已取消' } },
    },
  ],
  '/api/generator/list': [
    { method: 'get', summary: '生成列表', responses: { '200': { description: '列表' } } },
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
        'Node BFF 中间层 — Chat / RAG / Agent / Generator / Tools / Cost / Logs.\n\n所有接口带 `X-Request-Id` response header 用于链路追踪。',
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
      { name: 'Tools', description: 'Function Calling' },
      { name: 'Agent', description: 'Agent 编排' },
      { name: 'Generator', description: '文档生成器' },
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
