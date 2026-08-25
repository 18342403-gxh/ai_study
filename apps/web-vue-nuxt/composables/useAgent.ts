/**
 * useAgent — Agent 状态机 Composable
 * 
 * 连接 BFF /api/agent 接口
 * 支持 Agent SSE 流式运行、暂停、恢复、回滚
 * 
 * 服务端事件协议（streamEvents v2）：
 *   { type: 'thread_id', threadId }
 *   { type: 'event', event: 'on_chain_start', name, data }
 *   { type: 'event', event: 'on_chain_stream', name, data }
 *   { type: 'event', event: 'on_chain_end', name, data }
 *   { type: 'event', event: 'on_tool_start', name, data }
 *   { type: 'event', event: 'on_tool_end', name, data }
 *   { type: 'done', threadId }
 *   { type: 'error', message }
 */

import { ref, computed } from 'vue'
import type { AgentPhase, AgentStatus } from '@ai-study/shared'

interface Thought {
  node: AgentPhase
  content: string
  timestamp: number
}

interface ToolCall {
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'running' | 'completed' | 'error'
}

const state = ref<{
  threadId: string
  status: AgentStatus
  phase: AgentPhase
  iteration: number
  messageCount: number
  lastAnswer?: string
  error?: string
} | null>(null)

const isRunning = ref(false)
const phaseHistory = ref<Thought[]>([])
const toolCalls = ref<ToolCall[]>([])
const finalAnswer = ref('')
const error = ref<string | null>(null)
const currentThreadId = ref('')

export function useAgent() {
  const config = useRuntimeConfig()
  const bffUrl = config.public.bffUrl || 'http://localhost:3001'
  const baseUrl = `${bffUrl}/api/agent`

  const status = computed<AgentStatus>(() => state.value?.status ?? 'idle')

  const runAgent = async (input: string, threadId?: string) => {
    isRunning.value = true
    error.value = null
    finalAnswer.value = ''
    phaseHistory.value = []
    toolCalls.value = []
    state.value = null

    try {
      const body: Record<string, unknown> = { input }
      if (threadId) {
        body.threadId = threadId
      }

      const res = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || `Agent 运行失败: ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            handleEvent(parsed)
          } catch {}
        }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Agent 运行失败'
      if (state.value) {
        state.value.status = 'failed'
      }
    } finally {
      isRunning.value = false
    }
  }

  const handleEvent = (event: Record<string, unknown>) => {
    const type = event.type as string

    switch (type) {
      case 'thread_id':
        currentThreadId.value = event.threadId as string
        state.value = {
          threadId: event.threadId as string,
          status: 'running',
          phase: 'think',
          iteration: 0,
          messageCount: 0,
        }
        break

      case 'event': {
        const innerEvent = event.event as string
        const name = event.name as string
        const data = event.data as Record<string, unknown>

        switch (innerEvent) {
          case 'on_chain_start':
            phaseHistory.value.push({
              node: (name as AgentPhase) || 'think',
              content: data ? JSON.stringify(data) : '',
              timestamp: Date.now(),
            })
            if (state.value) {
              state.value.phase = (name as AgentPhase) || 'think'
              if (data && typeof data === 'object' && 'iteration' in data) {
                state.value.iteration = data.iteration as number
              }
            }
            break

          case 'on_chain_stream':
            if (name === 'think' || name === 'answer') {
              const delta = data as string
              finalAnswer.value += delta
            }
            break

          case 'on_chain_end':
            if (name === 'answer') {
              if (data && typeof data === 'object' && 'content' in data) {
                finalAnswer.value = data.content as string
              }
            }
            if (name === 'Agent') {
              if (data && typeof data === 'object') {
                state.value = {
                  threadId: currentThreadId.value,
                  status: (data.status as AgentStatus) || 'completed',
                  phase: 'answer',
                  iteration: (data.iterations as number) || state.value?.iteration || 0,
                  messageCount: 0,
                  lastAnswer: data.answer as string,
                }
                if (data.answer) {
                  finalAnswer.value = data.answer as string
                }
              }
            }
            break

          case 'on_tool_start':
            toolCalls.value.push({
              name: name,
              args: (data as Record<string, unknown>) || {},
              status: 'running',
            })
            break

          case 'on_tool_end': {
            const lastCall = toolCalls.value.filter((c) => c.name === name).pop()
            if (lastCall) {
              lastCall.status = 'completed'
              lastCall.result = data
            }
            break
          }

          case 'on_interrupt':
            if (state.value) {
              state.value.status = 'paused'
            }
            break

          case 'on_error':
            error.value = (data && typeof data === 'object' && 'message' in data) 
              ? (data.message as string) 
              : '未知错误'
            if (state.value) {
              state.value.status = 'failed'
            }
            break
        }
        break
      }

      case 'done':
        if (state.value) {
          state.value.status = 'completed'
        }
        break

      case 'error':
        error.value = event.message as string
        if (state.value) {
          state.value.status = 'failed'
        }
        break
    }
  }

  const pauseAgent = async (threadId: string) => {
    try {
      const res = await fetch(`${baseUrl}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      })
      if (!res.ok) throw new Error(`暂停失败: ${res.status}`)
      if (state.value) state.value.status = 'paused'
    } catch (err) {
      error.value = err instanceof Error ? err.message : '暂停失败'
    }
  }

  const resumeAgent = async (threadId: string, input: string) => {
    await runAgent(input, threadId)
  }

  const rollbackAgent = async (threadId: string, step: number) => {
    try {
      const res = await fetch(`${baseUrl}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, step }),
      })
      if (!res.ok) throw new Error(`回滚失败: ${res.status}`)
      const data = await res.json()
      if (state.value && data.state) {
        state.value.status = data.state.status || 'idle'
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '回滚失败'
    }
  }

  const reset = () => {
    state.value = null
    finalAnswer.value = ''
    phaseHistory.value = []
    toolCalls.value = []
    error.value = null
    currentThreadId.value = ''
  }

  return {
    state,
    status,
    isRunning,
    phaseHistory,
    toolCalls,
    finalAnswer,
    error,
    currentThreadId,
    runAgent,
    pauseAgent,
    resumeAgent,
    rollbackAgent,
    reset,
  }
}
