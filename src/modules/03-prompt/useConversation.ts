/**
 * 知识点 3.4/3.6：多轮对话 Hook + 滑动窗口策略
 *
 * 学习要点：
 * - messages 数组维护多轮对话上下文
 * - system 消息永远保留在首位
 * - assistant 回复自动加入历史
 * - 滑动窗口：超出 Token 预算时裁剪早期消息
 *
 * 面试相关：
 * - 多轮对话如何维护上下文
 * - Token 超限时如何处理
 */

import { useState, useCallback, useRef } from 'react'

import { chatCompletionStream } from '../../services/ai'
import { createSSEParser } from '../02-streaming/parseSSE'
import { estimateMessagesTokens } from './tokenCounter'
import type { ChatMessage } from './types'

interface UseConversationReturn {
  messages: ChatMessage[]
  isStreaming: boolean
  error: string
  tokenCount: number
  send: (content: string) => Promise<void>
  stop: () => void
  clear: () => void
  setSystemPrompt: (prompt: string) => void
}

const MAX_TOKENS = 4000 // Token 预算上限
const MAX_ROUNDS = 10   // 最多保留最近 N 轮对话

export const useConversation = (initialSystemPrompt: string): UseConversationReturn => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'system', content: initialSystemPrompt, timestamp: Date.now() },
  ])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState('')

  const controllerRef = useRef<AbortController | null>(null)

  // 📝 面试考点：实时计算当前对话的 Token 消耗
  const tokenCount = estimateMessagesTokens(messages)

  /**
   * 滑动窗口裁剪
   * 📝 面试考点：始终保留 system 消息，只裁剪 user/assistant 对话轮次
   */
  const applyWindow = useCallback((msgs: ChatMessage[]): ChatMessage[] => {
    const system = msgs[0] // system 永远保留
    const conversation = msgs.slice(1)

    // 按轮数裁剪（每轮 = 1 user + 1 assistant）
    if (conversation.length > MAX_ROUNDS * 2) {
      const trimmed = conversation.slice(-(MAX_ROUNDS * 2))
      return [system, ...trimmed]
    }

    // 按 Token 预算裁剪
    let result = [system, ...conversation]
    while (estimateMessagesTokens(result) > MAX_TOKENS && result.length > 2) {
      // 移除最早的一轮对话（system 后面的前两条）
      result = [result[0], ...result.slice(3)]
    }

    return result
  }, [])

  const setSystemPrompt = useCallback((prompt: string) => {
    setMessages([{ role: 'system', content: prompt, timestamp: Date.now() }])
    setError('')
  }, [])

  const stop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setIsStreaming(false)
  }, [])

  const clear = useCallback(() => {
    setMessages((prev) => [prev[0]]) // 只保留 system 消息
    setError('')
  }, [])

  const send = useCallback(async (content: string) => {
    controllerRef.current?.abort()
    setError('')
    setIsStreaming(true)

    // 📝 面试考点：新的 user 消息追加到数组
    const userMessage: ChatMessage = { role: 'user', content, timestamp: Date.now() }

    setMessages((prev) => {
      const updated = [...prev, userMessage]
      return applyWindow(updated)
    })

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      // 构造发送给 API 的消息（应用滑动窗口后的）
      const currentMessages = applyWindow([...messages, userMessage])
      const apiMessages = currentMessages.map(({ role, content: c }) => ({ role, content: c }))

      const response = await chatCompletionStream({
        messages: apiMessages.map((m) => ({ role: m.role, content: m.content })),
        signal: controller.signal,
      })

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      const parse = createSSEParser()
      let assistantContent = ''

      // 📝 面试考点：流式接收时实时更新 assistant 消息
      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        const results = parse(text)

        for (const result of results) {
          if (result.done) break
          if (result.content) {
            assistantContent += result.content
            // 实时更新最后一条 assistant 消息
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: assistantContent }]
              }
              return [...prev, { role: 'assistant', content: assistantContent, timestamp: Date.now() }]
            })
          }
        }
      }

      setIsStreaming(false)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // 用户中断，保留已有内容
      } else {
        setError(err instanceof Error ? err.message : '未知错误')
      }
      setIsStreaming(false)
    }
  }, [messages, applyWindow])

  return { messages, isStreaming, error, tokenCount, send, stop, clear, setSystemPrompt }
}
