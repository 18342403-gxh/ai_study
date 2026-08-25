/**
 * LangChain 链式调用封装（m1 基础 + m2 流式）
 * 提供 Runnable 抽象的链式 API
 * stream() 返回 AsyncGenerator，支持 for-await-of 消费
 */

import { createChatModel, type ChatMessage, type ModelConfig } from './model.js'

export interface ChatRequest {
  messages: ChatMessage[]
  model?: string
  stream?: boolean
  temperature?: number
  tools?: unknown[]
}

export interface ChatResponse {
  content: string
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
}

export const createChatChain = (config: ModelConfig = {}) => {
  const model = createChatModel(config)

  /** 非流式调用 */
  async function invoke(request: ChatRequest): Promise<ChatResponse> {
    const content = await model.invoke(request.messages)
    return { content }
  }

  /** 流式调用 — 返回 AsyncGenerator，支持 for-await-of */
  async function* stream(
    request: ChatRequest,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<string> {
    for await (const delta of model.stream(request.messages, options)) {
      yield delta
    }
  }

  return { invoke, stream }
}

export function simpleChat(
  prompt: string,
  config?: ModelConfig
): Promise<string> {
  const chain = createChatChain(config)
  return chain.invoke({
    messages: [{ role: 'user', content: prompt }],
  }).then((r) => r.content)
}

export async function simpleChatStream(
  prompt: string,
  onChunk: (delta: string) => void,
  config?: ModelConfig
): Promise<string> {
  const chain = createChatChain(config)
  let fullContent = ''
  for await (const delta of chain.stream({ messages: [{ role: 'user', content: prompt }] })) {
    fullContent += delta
    onChunk(delta)
  }
  return fullContent
}
