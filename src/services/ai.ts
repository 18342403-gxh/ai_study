/**
 * 知识点 0.3：AI API 统一封装
 * 
 * 学习要点：
 * - 统一的 fetch 请求封装
 * - 环境变量管理 API 配置
 * - TypeScript 类型安全
 * - 错误分类处理
 */

// Types
export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model?: string
  messages: Message[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

export interface ChatChoice {
  index: number
  message: Message
  finish_reason: string
}

export interface ChatResponse {
  id: string
  choices: ChatChoice[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

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

const API_URL = import.meta.env.VITE_AI_API_URL || 'https://api.openai.com/v1'
const API_KEY = import.meta.env.VITE_AI_API_KEY || ''

export const chatCompletion = async (
  request: ChatRequest,
  signal?: AbortSignal
): Promise<ChatResponse> => {
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: request.model || 'gpt-3.5-turbo',
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
      stream: request.stream ?? false,
    }),
    signal,
  })

  if (!response.ok) {
    const errorBody = await response.text()
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

  return response.json()
}

// Stream version - returns raw Response for streaming consumption
export const chatCompletionStream = async (
  request: ChatRequest,
  signal?: AbortSignal
): Promise<Response> => {
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: request.model || 'gpt-3.5-turbo',
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    const errorBody = await response.text()
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

  return response
}
