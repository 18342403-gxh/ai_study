/**
 * 知识点 1.4/1.6/1.7：自定义 Hook — useChat
 *
 * 学习要点：
 * - useState 管理 loading/error/data 三态
 * - useCallback 缓存函数避免不必要重渲染
 * - AbortController 实现请求超时和手动取消
 * - try-catch 错误分类（网络错误 vs HTTP 错误）
 * - 组件卸载时清理（防止内存泄漏）
 *
 * 面试相关：
 * - React Hook 异步状态管理模式
 * - AbortController 的工作原理
 * - 组件卸载后 setState 的问题
 */

import { useState, useCallback, useRef } from 'react'
import { fetchChatCompletion } from './api'
import type { Message } from './types'

interface UseChatReturn {
  reply: string
  isLoading: boolean
  error: string
  send: (messages: Message[]) => Promise<void>
  cancel: () => void
}

const TIMEOUT_MS = 30000 // 30秒超时

export const useChat = (): UseChatReturn => {
  const [reply, setReply] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // 📝 面试考点：useRef 存储 AbortController，不触发重渲染
  const controllerRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const send = useCallback(async (messages: Message[]) => {
    // 取消上一次未完成的请求
    cancel()

    setIsLoading(true)
    setError('')
    setReply('')

    // 📝 面试考点：每次请求创建新的 AbortController 实例
    const controller = new AbortController()
    controllerRef.current = controller

    // 📝 面试考点：setTimeout + abort() 实现请求超时
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetchChatCompletion(
        { messages },
        controller.signal
      )

      clearTimeout(timeoutId)

      const content = response.choices[0]?.message?.content || ''
      setReply(content)
    } catch (err) {
      clearTimeout(timeoutId)

      // 📝 面试考点：区分 AbortError（超时/取消）和其他错误
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          setError('请求超时或已取消')
        } else {
          setError(err.message)
        }
      } else {
        setError('未知错误')
      }
    } finally {
      setIsLoading(false)
      controllerRef.current = null
    }
  }, [cancel])

  return { reply, isLoading, error, send, cancel }
}
