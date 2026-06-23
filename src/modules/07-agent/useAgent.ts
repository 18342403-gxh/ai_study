/**
 * 知识点 7.2/7.6/7.7：Agent 执行 Hook
 *
 * 学习要点：
 * - Think-Act-Observe 循环实现
 * - 步骤数组累积（实时展示执行过程）
 * - 暂停/继续状态控制（Human-in-the-Loop）
 * - 中断与最大步骤数限制
 *
 * 面试相关：
 * - Agent 循环的实现方式
 * - Human-in-the-Loop 的前端交互设计
 */

import { useState, useCallback, useRef } from 'react'

import { chatWithTools } from '../../services/ai'
import { toolDefinitions } from '../05-function-calling/tools/definitions'
import { executeTools } from '../05-function-calling/tools/executor'
import type { AgentStep, AgentStatus } from './types'

const MAX_STEPS = 8  // 最大步骤数，防止死循环

/** 生成唯一 ID */
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

interface UseAgentReturn {
  steps: AgentStep[]
  status: AgentStatus
  error: string
  handleStart: (task: string) => Promise<void>
  handleStop: () => void
  handleReset: () => void
}

export const useAgent = (): UseAgentReturn => {
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  /** 添加一个步骤到时间线 */
  const addStep = useCallback((step: Omit<AgentStep, 'id' | 'timestamp'>) => {
    const newStep: AgentStep = {
      ...step,
      id: generateId(),
      timestamp: Date.now(),
    }
    setSteps((prev) => [...prev, newStep])
    return newStep
  }, [])

  const handleStop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus('failed')
  }, [])

  const handleReset = useCallback(() => {
    setSteps([])
    setStatus('idle')
    setError('')
    controllerRef.current?.abort()
  }, [])

  /**
   * 📝 面试考点：Think-Act-Observe 循环
   * AI 作为"大脑"决策下一步做什么，工具作为"手脚"执行操作
   */
  const handleStart = useCallback(async (task: string) => {
    if (!task.trim() || status === 'running') return

    setSteps([])
    setError('')
    setStatus('running')

    const controller = new AbortController()
    controllerRef.current = controller

    // 📝 面试考点：Agent 的 System Prompt 要求 AI 逐步思考
    const systemPrompt = `你是一个智能助手 Agent。请按以下步骤处理用户的任务：
1. 先分析任务，思考需要哪些信息
2. 如果需要，调用工具获取信息
3. 根据获取的信息给出最终回答

注意：每一步都要清晰说明你的思考过程。`

    // 维护完整消息历史
    const messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ]

    try {
      let stepCount = 0

      // 📝 面试考点：Agent 循环 — 持续执行直到得到最终答案或达到步骤上限
      while (stepCount < MAX_STEPS) {
        stepCount++

        // Think: 让 AI 思考下一步
        const response = await chatWithTools({
          messages: messages.map((m) => ({
            role: m.role as 'system' | 'user' | 'assistant' | 'tool',
            content: m.content,
            ...(m.tool_calls ? { tool_calls: m.tool_calls as { id: string; type: 'function'; function: { name: string; arguments: string } }[] } : {}),
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
            ...(m.name ? { name: m.name } : {}),
          })),
          tools: toolDefinitions,
          signal: controller.signal,
        })

        const choice = response.choices?.[0]
        const assistantMsg = choice?.message

        if (!assistantMsg) {
          throw new Error('AI 响应格式异常')
        }

        const hasToolCalls = assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0

        if (!hasToolCalls) {
          // 📝 面试考点：AI 直接回答 — Agent 循环结束
          // 如果有思考内容，先记录思考
          if (assistantMsg.content) {
            addStep({ type: 'final_answer', content: assistantMsg.content })
          }
          messages.push({ role: 'assistant', content: assistantMsg.content || '' })
          setStatus('completed')
          break
        }

        // 记录 AI 的思考过程（如果有 content）
        if (assistantMsg.content) {
          addStep({ type: 'thinking', content: assistantMsg.content })
        }

        // Act: 执行工具
        messages.push({
          role: 'assistant',
          content: assistantMsg.content || '',
          tool_calls: assistantMsg.tool_calls,
        })

        const toolCalls = (assistantMsg.tool_calls || []).map((tc) => ({
          id: tc.id,
          function: tc.function,
        }))

        // 记录工具调用步骤
        for (const tc of toolCalls) {
          addStep({
            type: 'tool_call',
            content: `调用 ${tc.function.name}`,
            toolName: tc.function.name,
            toolArgs: tc.function.arguments,
          })
        }

        // 执行工具
        const results = executeTools(toolCalls)

        // Observe: 记录工具结果
        for (const result of results) {
          addStep({
            type: 'tool_result',
            content: result.result,
            toolName: result.name,
            isError: result.isError,
          })

          messages.push({
            role: 'tool',
            content: result.result,
            tool_call_id: result.toolCallId,
            name: result.name,
          })
        }
        // 继续循环（下一轮 Think）
      }

      if (stepCount >= MAX_STEPS) {
        setError('Agent 执行步骤超出限制')
        setStatus('failed')
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
        setStatus('failed')
      }
    } finally {
      controllerRef.current = null
    }
  }, [status, addStep])

  return { steps, status, error, handleStart, handleStop, handleReset }
}
