/**
 * 知识点 2.2/2.4/2.8：流式响应 Hook
 *
 * 学习要点：
 * - fetch + ReadableStream 读取流式数据
 * - TextDecoder 解码二进制为文本
 * - 状态机设计（idle/streaming/done/aborted）
 * - AbortController 中断流 + reader.cancel()
 * - useRef 存储可变状态避免闭包陷阱
 *
 * 面试相关：
 * - 手写 ReadableStream 消费逻辑
 * - 流式渲染性能优化方案
 */

import { useState, useCallback, useRef } from 'react'

import { chatCompletionStream } from '../../services/ai'
import { createSSEParser } from './parseSSE'
import type { Message } from '../01-api-basics/types'

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'aborted'

interface UseStreamingReturn {
  content: string
  status: StreamStatus
  error: string
  start: (messages: Message[]) => Promise<void>
  stop: () => void
}

export const useStreaming = (): UseStreamingReturn => {
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [error, setError] = useState('')

  // 📝 面试考点：useRef 存储可变值，不触发重渲染，避免闭包中拿到旧值
  const controllerRef = useRef<AbortController | null>(null)
  const contentRef = useRef('')

  const stop = useCallback(() => {
    // 📝 面试考点：中断流需要同时 abort fetch 和 cancel reader
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus('aborted')
  }, [])

  const start = useCallback(async (messages: Message[]) => {
    // 取消上一次
    controllerRef.current?.abort()

    // 重置状态
    setContent('')
    setError('')
    setStatus('streaming')
    contentRef.current = ''

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      // 📝 面试考点：stream: true 告诉 API 以 SSE 格式逐步返回
      const response = await chatCompletionStream({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        signal: controller.signal,
      })

      // 📝 面试考点：response.body 是一个 ReadableStream
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法获取响应流')
      }

      // 📝 面试考点：TextDecoder 将 Uint8Array 解码为字符串
      const decoder = new TextDecoder()
      const parse = createSSEParser()

      // 📝 面试考点：while 循环持续读取，直到 done=true 或手动中断
      while (true) {
        const { value, done } = await reader.read()

        if (done) break

        // 解码当前 chunk
        const text = decoder.decode(value, { stream: true })
        const results = parse(text)

        for (const result of results) {
          if (result.done) {
            setStatus('done')
            return
          }
          if (result.content) {
            // 📝 面试考点：用 ref 累积内容，再批量更新 state，减少重渲染次数
            contentRef.current += result.content
            setContent(contentRef.current)
          }
        }
      }

      setStatus('done')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // 用户主动取消，保留已生成内容
        setStatus('aborted')
      } else {
        setError(err instanceof Error ? err.message : '未知错误')
        setStatus('idle')
      }
    }
  }, [])

  return { content, status, error, start, stop }
}
