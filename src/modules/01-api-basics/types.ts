/**
 * 知识点 1.1：TypeScript 类型定义
 *
 * 学习要点：
 * - 大模型 API 的数据结构
 * - role 的三种类型：system/user/assistant
 * - temperature/max_tokens 参数含义
 * - 响应结构：choices 数组 + usage 统计
 *
 * 面试相关：
 * - temperature 参数的作用和取值范围
 * - 为什么 API 返回的是 choices 数组而不是单个结果
 */

// 📝 面试考点：消息角色类型 — system 设定行为，user 提问，assistant 回答
export type MessageRole = 'system' | 'user' | 'assistant'

export interface Message {
  role: MessageRole
  content: string
}

// 📝 面试考点：temperature 控制随机性，0=确定性输出，2=高创造性
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

// 📝 面试考点：usage 字段用于统计 Token 消耗，控制成本
export interface ChatResponse {
  id: string
  choices: ChatChoice[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
