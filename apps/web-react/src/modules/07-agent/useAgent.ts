/**
 * 知识点 7.2/7.6/7.7：Agent 执行 Hook
 *
 * 学习要点：
 * - Think-Act-Observe 循环实现
 * - 流式接收最终回答（打字机效果）
 * - 步骤数组累积（实时展示执行过程）
 * - 中断与最大步骤数限制
 */

import { useState, useCallback, useRef } from 'react'

import { chatWithTools, chatCompletionStream } from '../../services/ai'
import { toolDefinitions } from '../05-function-calling/tools/definitions'
import { executeTools } from '../05-function-calling/tools/executor'
import { createSSEParser } from '../02-streaming/parseSSE'
import type { AgentStep, AgentStatus } from './types'

const MAX_STEPS = 8

const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

interface UseAgentReturn {
  steps: AgentStep[]
  status: AgentStatus
  error: string
  streamingContent: string  // 流式回答的当前内容
  handleStart: (task: string) => Promise<void>
  handleStop: () => void
  handleReset: () => void
}

export const useAgent = (): UseAgentReturn => {
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [error, setError] = useState('')
  const [streamingContent, setStreamingContent] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  const addStep = useCallback((step: Omit<AgentStep, 'id' | 'timestamp'>): string => {
    const id = generateId()
    const newStep: AgentStep = { ...step, id, timestamp: Date.now() }
    setSteps((prev) => [...prev, newStep])
    return id
  }, [])

  /** 更新指定步骤的内容（用于流式更新） */
  const updateStep = useCallback((stepId: string, content: string) => {
    setSteps((prev) => prev.map((s) =>
      s.id === stepId ? { ...s, content } : s
    ))
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
    setStreamingContent('')
    controllerRef.current?.abort()
  }, [])

  const handleStart = useCallback(async (task: string) => {
    if (!task.trim() || status === 'running') return

    setSteps([])
    setError('')
    setStreamingContent('')
    setStatus('running')

    const controller = new AbortController()
    controllerRef.current = controller

    const systemPrompt = `你是一个智能助手 Agent。处理任务时请按以下步骤：
1. 先分析任务需要什么信息
2. 如果需要外部信息，调用合适的工具
3. 根据收集到的信息给出完整的最终回答

每一步都要说明思考过程。回答要详细有用。`

    const messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ]

    // 先添加一个"思考中"步骤
    addStep({ type: 'thinking', content: '正在分析任务...' })

    try {
      let stepCount = 0

      while (stepCount < MAX_STEPS) {
        stepCount++

        // 调用 API（带工具）判断是否需要调用工具
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
        if (!assistantMsg) throw new Error('AI 响应格式异常')

        const hasToolCalls = assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0

        if (!hasToolCalls) {
          // 没有工具调用 — 进入流式最终回答阶段
          // 更新思考步骤
          if (assistantMsg.content) {
            setSteps((prev) => {
              const updated = [...prev]
              // 移除初始的"思考中"提示
              const thinkingIdx = updated.findIndex((s) => s.content === '正在分析任务...')
              if (thinkingIdx >= 0) {
                updated[thinkingIdx] = { ...updated[thinkingIdx], content: '分析完成，正在生成回答...' }
              }
              return updated
            })
          }

          // 用流式请求生成最终回答（打字机效果）
          const finalStepId = addStep({ type: 'final_answer', content: '' })

          const streamResponse = await chatCompletionStream({
            messages: messages.map((m) => ({
              role: m.role as 'system' | 'user' | 'assistant' | 'tool',
              content: m.content,
              ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
              ...(m.name ? { name: m.name } : {}),
            })),
            signal: controller.signal,
          })

          const reader = streamResponse.body?.getReader()
          if (!reader) throw new Error('无法获取响应流')

          const decoder = new TextDecoder()
          const parse = createSSEParser()
          let fullContent = ''

          while (true) {
            const { value, done } = await reader.read()
            if (done) break

            const text = decoder.decode(value, { stream: true })
            const results = parse(text)

            for (const result of results) {
              if (result.done) break
              if (result.content) {
                fullContent += result.content
                setStreamingContent(fullContent)
                updateStep(finalStepId, fullContent)
              }
            }
          }

          setStatus('completed')
          break
        }

        // 有工具调用 — 执行 Think-Act-Observe
        // 记录思考（如果 AI 返回了 content）
        if (assistantMsg.content) {
          addStep({ type: 'thinking', content: assistantMsg.content })
        }

        messages.push({
          role: 'assistant',
          content: assistantMsg.content || '',
          tool_calls: assistantMsg.tool_calls,
        })

        // 记录并执行工具调用
        const toolCalls = (assistantMsg.tool_calls || []).map((tc) => ({
          id: tc.id,
          function: tc.function,
        }))

        for (const tc of toolCalls) {
          addStep({
            type: 'tool_call',
            content: `调用 ${tc.function.name}`,
            toolName: tc.function.name,
            toolArgs: tc.function.arguments,
          })
        }

        const results = executeTools(toolCalls)

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

        // 添加"继续思考"提示
        addStep({ type: 'thinking', content: '正在根据工具结果继续分析...' })
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
  }, [status, addStep, updateStep])

  return { steps, status, error, streamingContent, handleStart, handleStop, handleReset }
}
