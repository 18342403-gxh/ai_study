/**
 * AI API 统一封装层
 *
 * 所有模块的 AI 请求都通过这里发出，统一管理：
 * - API URL 和 Key（环境变量）
 * - 请求头
 * - 默认模型
 * - 错误处理和分类
 * - 支持普通请求、流式请求、带工具的请求
 */

// ====== 类型定义 ======

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCallInfo[]
  tool_call_id?: string
  name?: string
}

export interface ToolCallInfo {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatRequestOptions {
  messages: Message[]
  model?: string
  temperature?: number
  max_tokens?: number
  stream?: boolean
  tools?: unknown[]
  signal?: AbortSignal
}

export interface ChatChoice {
  index: number
  message: Message & { tool_calls?: ToolCallInfo[] }
  finish_reason: string
}

export interface ChatResponse {
  id: string
  choices: ChatChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// ====== 错误类 ======

export class AIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message)
    this.name = 'AIError'
  }
}

// ====== 配置常量 ======

const API_URL = import.meta.env.VITE_AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4'
const API_KEY = import.meta.env.VITE_AI_API_KEY || ''
const DEFAULT_MODEL = 'glm-4-flash'

// ====== 内部工具函数 ======

/** 统一构造请求头 */
const buildHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
})

/** 统一错误处理 */
const handleResponseError = async (response: Response): Promise<never> => {
  const errorBody = await response.text().catch(() => '')
  let message = '请求失败'

  switch (response.status) {
    case 401:
      message = 'API Key 无效或已过期'
      break
    case 429:
      message = '请求过于频繁，请稍后重试'
      break
    case 500:
      message = '服务器内部错误'
      break
    default:
      message = `请求失败 (${response.status}): ${errorBody}`
  }

  throw new AIError(message, response.status)
}

/** 构造请求 body */
const buildRequestBody = (options: ChatRequestOptions): string => {
  const body: Record<string, unknown> = {
    model: options.model || DEFAULT_MODEL,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    stream: options.stream ?? false,
  }
  if (options.max_tokens) {
    body.max_tokens = options.max_tokens
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools
  }
  return JSON.stringify(body)
}

// ====== 公开 API 方法 ======

/**
 * 普通聊天请求（非流式）
 * 返回完整的 ChatResponse
 */
export const chatCompletion = async (options: ChatRequestOptions): Promise<ChatResponse> => {
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: buildRequestBody({ ...options, stream: false }),
    signal: options.signal,
  })

  if (!response.ok) {
    await handleResponseError(response)
  }

  return response.json()
}

/**
 * 流式聊天请求
 * 返回原始 Response，调用方自行消费 body stream
 */
export const chatCompletionStream = async (options: ChatRequestOptions): Promise<Response> => {
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: buildRequestBody({ ...options, stream: true }),
    signal: options.signal,
  })

  if (!response.ok) {
    await handleResponseError(response)
  }

  return response
}

/**
 * 带工具调用的聊天请求（非流式）
 * 与 chatCompletion 相同，但语义更明确
 */
export const chatWithTools = async (options: ChatRequestOptions): Promise<ChatResponse> => {
  return chatCompletion(options)
}
