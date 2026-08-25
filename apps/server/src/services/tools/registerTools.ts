/**
 * Function Calling 工具注册表 + 内置工具集
 * 4 件套：Zod Schema + 注册中心 + 执行引擎 + 前端白名单
 */

import { z, type ZodType } from 'zod'
import { randomUUID } from 'crypto'
import { getDb } from '../../db/index.js'

export interface ToolDefinition {
  name: string
  description: string
  schema: ZodType
  execute: (args: Record<string, unknown>, context?: ToolContext) => Promise<unknown>
}

export interface ToolContext {
  sessionId?: string
  userId?: string
}

const registry = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  if (registry.has(tool.name)) {
    throw new Error(`工具 ${tool.name} 已注册`)
  }
  registry.set(tool.name, tool)
}

export function registerTools(tools: ToolDefinition[]): void {
  tools.forEach((t) => registerTool(t))
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name)
}

export function getAllTools(): ToolDefinition[] {
  return Array.from(registry.values())
}

export function getToolsByWhitelist(allowedToolIds: string[]): ToolDefinition[] {
  return allowedToolIds
    .map((id) => registry.get(id))
    .filter((t): t is ToolDefinition => t !== undefined)
}

/** 清空所有工具（测试用） */
export function clearTools(): void {
  registry.clear()
}

/** 将 Zod schema 转为 LLM 可识别的 JSON Schema */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return schema._def as unknown as Record<string, unknown>
}

/**
 * 执行工具调用（含参数校验 + 审计日志）
 */
export async function executeTool(
  toolName: string,
  rawArgs: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  const tool = getTool(toolName)
  if (!tool) throw new Error(`工具 ${toolName} 不存在`)

  const parsed = tool.schema.safeParse(rawArgs)
  if (!parsed.success) {
    throw new Error(`工具参数校验失败: ${parsed.error.message}`)
  }

  const result = await tool.execute(parsed.data as Record<string, unknown>, context)

  // 审计日志
  if (context?.sessionId) {
    const db = getDb()
    db.prepare(
      `INSERT INTO tool_calls (id, session_id, tool_name, args_json, result_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?)`
    ).run(
      randomUUID(),
      context.sessionId,
      toolName,
      JSON.stringify(parsed.data),
      JSON.stringify(result),
      Date.now()
    )
  }

  return result
}

// ==================== 内置工具定义 ====================

export const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: '获取指定城市的天气信息',
  schema: z.object({
    city: z.string().describe('城市名称，如 北京、上海'),
    date: z.string().optional().describe('日期，格式 YYYY-MM-DD，默认为今天'),
  }),
  async execute(args) {
    return {
      city: args.city,
      date: args.date || new Date().toISOString().slice(0, 10),
      temperature: '22°C',
      condition: '晴',
      humidity: '45%',
      wind: '东北风 3级',
    }
  },
}

export const searchDocsTool: ToolDefinition = {
  name: 'search_documents',
  description: '在知识库中检索相关文档',
  schema: z.object({
    query: z.string().describe('搜索关键词或问题'),
    topK: z.number().int().min(1).max(10).optional().describe('返回数量'),
  }),
  async execute(args) {
    return {
      query: args.query,
      results: [],
      note: '需要接入 RAG 检索服务',
    }
  },
}

export const listSessionsTool: ToolDefinition = {
  name: 'list_sessions',
  description: '列出当前用户的会话列表',
  schema: z.object({
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async execute(args) {
    const db = getDb()
    const sessions = db
      .prepare(
        `SELECT s.*, COUNT(m.id) as message_count
         FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
         GROUP BY s.id ORDER BY s.updated_at DESC LIMIT ?`
      )
      .all(args.limit || 20)
    return { sessions }
  },
}

export const getTimeTool: ToolDefinition = {
  name: 'get_current_time',
  description: '获取当前时间',
  schema: z.object({
    timezone: z.string().optional().describe('时区，如 Asia/Shanghai'),
  }),
  async execute(args) {
    return {
      time: new Date().toISOString(),
      timezone: args.timezone || 'UTC',
      timestamp: Date.now(),
    }
  },
}

/** 默认注册所有内置工具 */
export function initDefaultTools(): void {
  if (registry.size > 0) return
  registerTools([weatherTool, searchDocsTool, listSessionsTool, getTimeTool])
}
