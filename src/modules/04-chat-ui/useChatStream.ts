/**
 * 聊天流式请求 Hook
 * 封装发送消息 + 流式接收 + 中断的逻辑
 */

import { useState, useCallback, useRef, useMemo } from 'react'

import { createSSEParser } from '../02-streaming/parseSSE'
import { useChatStore } from './useChatStore'
import type { ChatMessage } from './useChatStore'

const API_URL = import.meta.env.VITE_AI_API_URL || 'https://api.openai.com/v1'
const API_KEY = import.meta.env.VITE_AI_API_KEY || ''

interface UseChatStreamReturn {
  isStreaming: boolean
  handleSend: (content: string) => Promise<void>
  handleStop: () => void
}

export const useChatStream = (messages: ChatMessage[]): UseChatStreamReturn => {
  const [isStreaming, setIsStreaming] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const { addMessage, updateLastAssistant } = useChatStore()

  // 用 useMemo 稳定 messages 引用，避免 useCallback 依赖频繁变化
  const stableMessages = useMemo(() => messages, [messages])

  const handleStop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setIsStreaming(false)
  }, [])

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return

    addMessage({ role: 'user', content })
    setIsStreaming(true)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      // 构造完整的对话消息数组
      const apiMessages = [
        { role: 'system' as const, content: '你是一个友好的 AI 助手，请用中文回答。' },
        ...stableMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content },
      ]

      const response = await fetch(`${API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: 'glm-4-flash',
          messages: apiMessages,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      const parse = createSSEParser()
      let assistantContent = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        const results = parse(text)

        for (const result of results) {
          if (result.done) break
          if (result.content) {
            assistantContent += result.content
            updateLastAssistant(assistantContent)
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        updateLastAssistant(`请求出错：${err.message}`)
      }
    } finally {
      setIsStreaming(false)
      controllerRef.current = null
    }
  }, [isStreaming, stableMessages, addMessage, updateLastAssistant])

  return { isStreaming, handleSend, handleStop }
}
