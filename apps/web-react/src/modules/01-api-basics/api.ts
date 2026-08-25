/**
 * 知识点 1.3：封装 API 调用函数
 *
 * 学习要点：
 * - fetch 请求头设置（Content-Type + Authorization）
 * - Authorization Bearer Token 格式
 * - 请求体 JSON 序列化
 * - 响应解析与错误分类
 *
 * 面试相关：
 * - 如何在前端安全管理 API Key
 * - fetch 与 XMLHttpRequest 的区别
 * - fetch 的错误处理为什么要判断 response.ok
 */

import type { ChatRequest, ChatResponse } from './types'

// 📝 面试考点：环境变量管理 — VITE_ 前缀变量才会暴露给客户端代码
const API_URL = import.meta.env.VITE_AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4'
const API_KEY = import.meta.env.VITE_AI_API_KEY || ''

// 📝 面试考点：自定义错误类，携带 HTTP 状态码便于上层分类处理
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * 调用 Chat Completions API
 * 📝 面试考点：fetch 请求头必须设置 Content-Type 和 Authorization
 */
export const fetchChatCompletion = async (
  request: ChatRequest,
  signal?: AbortSignal
): Promise<ChatResponse> => {
  // 📝 面试考点：fetch 只有网络错误才会 reject，HTTP 4xx/5xx 不会
  const response = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: request.model || 'glm-4-flash',
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens,
      stream: false,
    }),
    signal,
  })

  // 📝 面试考点：必须手动判断 response.ok，因为 fetch 对 4xx/5xx 不会 reject
  if (!response.ok) {
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
        message = `请求失败 (${response.status})`
    }
    throw new ApiError(message, response.status)
  }

  return response.json()
}
