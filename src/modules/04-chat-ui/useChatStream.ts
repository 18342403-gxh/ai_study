/**
 * 聊天流式请求 Hook
 * 封装发送消息 + 流式接收 + 中断的逻辑
 */

import { useState, useCallback, useRef } from 'react'

import { chatCompletionStream } from '../../services/ai'
import { useAppDispatch } from '../../store'
import { addMessage, updateLastAssistant } from '../../store/chatSlice'
import { createSSEParser } from '../02-streaming/parseSSE'
import type { ChatMessage } from '../../store/chatSlice'

interface UseChatStreamReturn {
  isStreaming: boolean
  handleSend: (content: string) => Promise<void>
  handleStop: () => void
}

export const useChatStream = (messages: ChatMessage[]): UseChatStreamReturn => {
  const [isStreaming, setIsStreaming] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const dispatch = useAppDispatch()

  const handleStop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setIsStreaming(false)
  }, [])

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return

    // 添加用户消息到 store
    dispatch(addMessage({ role: 'user', content }))
    setIsStreaming(true)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      // 通过统一服务层发起流式请求
      const response = await chatCompletionStream({
        messages: [
          { role: 'system', content: '你是一个友好的 AI 助手，请用中文回答。' },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content },
        ],
        signal: controller.signal,
      })

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
            dispatch(updateLastAssistant(assistantContent))
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        dispatch(updateLastAssistant(`请求出错：${err.message}`))
      }
    } finally {
      setIsStreaming(false)
      controllerRef.current = null
    }
  }, [isStreaming, messages, dispatch])

  return { isStreaming, handleSend, handleStop }
}
