/**
 * 知识点 5.4/5.7：工具调用流程编排 Hook
 *
 * 学习要点：
 * - 检测 response 中的 tool_calls 字段
 * - 执行工具 → 构造 tool message → 再次请求 API
 * - 循环调用直到无 tool_calls（多步工具链）
 * - 最大调用次数限制防止死循环
 *
 * 面试相关：
 * - Function Calling 的完整消息流转
 * - 如何防止工具调用死循环
 */

import { useState, useCallback, useRef } from 'react'

import { toolDefinitions } from './tools/definitions'
import { executeTools } from './tools/executor'
import type { ToolCall, ToolResult } from './tools/executor'

const API_URL = import.meta.env.VITE_AI_API_URL || 'https://api.openai.com/v1'
const API_KEY = import.meta.env.VITE_AI_API_KEY || ''
const MAX_TOOL_ROUNDS = 5  // 📝 面试考点：防止死循环的最大轮次

/** 对话中的消息（包含 tool 角色） */
interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

/** 展示给 UI 的步骤信息 */
export interface ToolStep {
  id: string
  type: 'tool_call' | 'tool_result' | 'final_answer'
  toolName?: string
  toolArgs?: string
  toolResult?: string
  isError?: boolean
  content?: string
}

interface UseToolChatReturn {
  steps: ToolStep[]
  isProcessing: boolean
  error: string
  handleSend: (content: string) => Promise<void>
  handleReset: () => void
}

export const useToolChat = (): UseToolChatReturn => {
  const [steps, setSteps] = useState<ToolStep[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  const handleReset = useCallback(() => {
    setSteps([])
    setError('')
    controllerRef.current?.abort()
  }, [])

  /**
   * 📝 面试考点：工具调用的核心循环
   * 发送消息 → 检测 tool_calls → 执行工具 → 发回结果 → 再检测 → 直到无 tool_calls
   */
  const handleSend = useCallback(async (content: string) => {
    if (!content.trim() || isProcessing) return

    setIsProcessing(true)
    setError('')
    setSteps([])

    const controller = new AbortController()
    controllerRef.current = controller

    // 维护完整的消息历史（包含 tool 消息）
    const messages: ChatMsg[] = [
      { role: 'system', content: '你是一个有用的助手，可以使用提供的工具来回答问题。' },
      { role: 'user', content },
    ]

    try {
      let roundCount = 0

      // 📝 面试考点：循环检测 tool_calls，直到 AI 直接回复文字
      while (roundCount < MAX_TOOL_ROUNDS) {
        roundCount++

        const response = await fetch(`${API_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            model: 'glm-4-flash',
            messages,
            tools: toolDefinitions,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`请求失败 (${response.status})`)
        }

        const data = await response.json()
        const choice = data.choices?.[0]
        const assistantMsg = choice?.message

        if (!assistantMsg) {
          throw new Error('API 响应格式异常')
        }

        // 📝 面试考点：判断 AI 是否要调用工具
        const hasToolCalls = assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0

        if (!hasToolCalls) {
          // AI 直接回复文字 — 流程结束
          setSteps((prev) => [...prev, {
            id: `final-${roundCount}`,
            type: 'final_answer',
            content: assistantMsg.content || '',
          }])
          // 把 assistant 消息加入历史
          messages.push({ role: 'assistant', content: assistantMsg.content || '' })
          break
        }

        // AI 要调用工具 — 执行工具并构造 tool messages
        messages.push({
          role: 'assistant',
          content: assistantMsg.content || '',
          tool_calls: assistantMsg.tool_calls,
        })

        // 记录工具调用步骤（展示给 UI）
        const toolCalls: ToolCall[] = assistantMsg.tool_calls
        for (const tc of toolCalls) {
          setSteps((prev) => [...prev, {
            id: tc.id,
            type: 'tool_call',
            toolName: tc.function.name,
            toolArgs: tc.function.arguments,
          }])
        }

        // 📝 面试考点：执行所有工具并构造 tool message 发回
        const results: ToolResult[] = executeTools(toolCalls)

        for (const result of results) {
          // 记录工具结果步骤
          setSteps((prev) => [...prev, {
            id: `result-${result.toolCallId}`,
            type: 'tool_result',
            toolName: result.name,
            toolResult: result.result,
            isError: result.isError,
          }])

          // 构造 tool message 加入消息历史
          messages.push({
            role: 'tool',
            content: result.result,
            tool_call_id: result.toolCallId,
            name: result.name,
          })
        }
        // 继续循环，让 AI 基于工具结果生成回复（或继续调用工具）
      }

      // 超出最大轮次
      if (roundCount >= MAX_TOOL_ROUNDS) {
        setError('工具调用轮次超出限制')
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setIsProcessing(false)
      controllerRef.current = null
    }
  }, [isProcessing])

  return { steps, isProcessing, error, handleSend, handleReset }
}
