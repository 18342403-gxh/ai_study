/**
 * Agent — StateGraph 实现（m7）
 *
 * 架构：LangGraph StateGraph 4 节点 + 条件边 + Checkpointer
 *   Node 1: think        → LLM 思考，决定下一步
 *   Node 2: call_tools  → 调用 Function Calling Engine
 *   Node 3: observe      → 工具结果喂回上下文
 *   Node 4: answer       → 输出最终答案
 *
 * 事件协议（streamEvents v2 兼容格式）：
 *   { event: 'on_chain_start'/'on_chain_end'/'on_tool_start'/'on_tool_end'/'on_chain_stream', ... }
 */

import { createChatChain } from '../chain/chatChain.js'
import { createFunctionCallingEngine } from '../tools/engine.js'
import { checkInputSafety, checkOutputGuardrail, checkToolPolicy } from './harness/index.js'
import { getDb } from '../../db/index.js'
import { z } from 'zod'

/** StateGraph 节点 */
export type AgentNode = 'think' | 'call_tools' | 'observe' | 'answer'

/** Agent 状态 */
export interface AgentState {
  threadId: string
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>
  thoughts: Array<{ node: AgentNode; content: string; timestamp: number }>
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>
  currentNode: AgentNode
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error'
  iteration: number
  lastAnswer?: string
}

/** streamEvents v2 事件 */
export interface AgentStreamEvent {
  event: string
  name?: string
  data?: unknown
  metadata?: Record<string, unknown>
}

export interface AgentConfig {
  maxIterations?: number
  enabledToolIds?: string[]
  systemPrompt?: string
  temperature?: number
  interruptOn?: AgentNode[]
}

/** 获取 Agent 状态 */
export function getState(threadId: string): AgentState {
  const db = getDb()
  const row = db
    .prepare('SELECT state_json FROM agent_states WHERE thread_id = ?')
    .get(threadId) as { state_json: string } | undefined

  if (row) return JSON.parse(row.state_json)

  return {
    threadId,
    messages: [],
    thoughts: [],
    toolCalls: [],
    currentNode: 'think',
    status: 'idle',
    iteration: 0,
  }
}

/** 持久化 Agent 状态 */
function persistState(state: AgentState): void {
  const db = getDb()
  const now = Date.now()
  db.prepare(
    `INSERT INTO agent_states (thread_id, state_json, status, current_node, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       state_json = excluded.state_json,
       status = excluded.status,
       current_node = excluded.current_node,
       updated_at = excluded.updated_at`
  ).run(state.threadId, JSON.stringify(state), state.status, state.currentNode, now, now)
}

/** Agent 输入校验 Schema */
export const agentInputSchema = z.object({
  threadId: z.string().optional(),
  input: z.string().min(1),
  allowedToolIds: z.array(z.string()).optional(),
  maxIterations: z.coerce.number().int().min(1).max(20).default(10),
  systemPrompt: z.string().optional(),
})

/**
 * Agent 实例接口
 */
export interface AgentExecutor {
  streamEvents(threadId: string, userInput: string, initialState?: Partial<AgentState>): AsyncGenerator<AgentStreamEvent>
  run(threadId: string, userInput: string): Promise<AgentState>
  rollback(threadId: string, step: number): AgentState
  pause(threadId: string): AgentState
  resume(threadId: string, userInput: string): AsyncGenerator<AgentStreamEvent>
}

/**
 * 创建 Agent 执行器
 */
export function createAgentExecutor(config: AgentConfig = {}): AgentExecutor {
  const maxIter = config.maxIterations || 10
  const enabledTools = config.enabledToolIds
  const systemPrompt = config.systemPrompt || '你是一个智能 Agent，可以使用工具完成用户任务。'
  const temperature = config.temperature ?? 0.7
  const interruptOn = config.interruptOn || []

  async function* streamEvents(
    threadId: string,
    userInput: string,
    initialState?: Partial<AgentState>
  ): AsyncGenerator<AgentStreamEvent> {
    const base: AgentState = {
      threadId,
      messages: [{ role: 'user', content: userInput }],
      thoughts: [],
      toolCalls: [],
      currentNode: 'think',
      status: 'running',
      iteration: 0,
    }
    const state: AgentState = Object.assign(base, initialState || {})

    persistState(state)

    yield {
      event: 'on_chain_start',
      name: 'Agent',
      data: { threadId, input: userInput },
      metadata: { node: 'start' },
    }

    const chain = createChatChain({ temperature })
    const fcEngine = createFunctionCallingEngine({
      allowedToolIds: enabledTools,
      systemPrompt,
    })

    while (state.status === 'running' && state.iteration < maxIter) {
      state.iteration++
      state.currentNode = 'think'

      // ── Harness ①: 输入安全检查（think 前） ──
      const lastUserMsg = [...state.messages].reverse().find(m => m.role === 'user')?.content || userInput
      const safetyCheck = checkInputSafety(lastUserMsg)
      yield { event: 'on_harness_check', data: safetyCheck }
      if (safetyCheck.result === 'block') {
        state.status = 'error'
        state.lastAnswer = `⚠️ Harness 拦截：${safetyCheck.reason}`
        state.messages.push({ role: 'assistant', content: state.lastAnswer })
        persistState(state)
        break
      }

      if (interruptOn.includes('think')) {
        state.status = 'paused'
        persistState(state)
        yield { event: 'on_interrupt', data: { node: 'think', reason: 'Human-in-the-loop' } }
        break
      }

      yield { event: 'on_chain_start', name: 'think', data: { iteration: state.iteration } }

      const thinkMessages = [
        { role: 'system' as const, content: `${systemPrompt}\n\n判断：用户是否需要调用工具？如果需要，返回工具名和参数。如果不需要，直接给出回答。` },
        ...state.messages,
      ]

      let thinkContent = ''
      for await (const delta of chain.stream({ messages: thinkMessages, stream: true })) {
        thinkContent += delta
        yield { event: 'on_chain_stream', name: 'think', data: delta }
      }
      yield { event: 'on_chain_end', name: 'think', data: { content: thinkContent } }

      state.thoughts.push({ node: 'think', content: thinkContent, timestamp: Date.now() })

      const toolMatch = thinkContent.match(/\[TOOL_CALL\]\s*(.+?)\s*\[\/TOOL_CALL\]/s)
      if (toolMatch) {
        try {
          const parsed = JSON.parse(toolMatch[1])

          state.currentNode = 'call_tools'
          yield { event: 'on_chain_start', name: 'call_tools', data: parsed }
          yield { event: 'on_tool_start', name: parsed.name, data: parsed.args || {} }

          // ── Harness ②: 工具调用策略检查 ──
          const policyCheck = checkToolPolicy(parsed.name, (parsed.args || {}) as Record<string, unknown>)
          yield { event: 'on_harness_check', data: policyCheck }
          if (policyCheck.result === 'block') {
            yield { event: 'on_error', data: { message: `Harness 拦截工具调用: ${policyCheck.reason}` } }
            state.messages.push({ role: 'assistant', content: `⚠️ 工具被拦截：${policyCheck.reason}` })
            state.messages.push({ role: 'tool', content: JSON.stringify({ tool: parsed.name, blocked: true, reason: policyCheck.reason }) })
            state.currentNode = 'observe'
            persistState(state)
            continue
          }

          const results = await fcEngine.run(state.messages)

          yield { event: 'on_tool_end', name: parsed.name, data: results.toolCalls }

          state.toolCalls.push(...(results.toolCalls as Array<{ name: string; args: Record<string, unknown>; result?: unknown }>))

          state.currentNode = 'observe'
          state.messages.push({ role: 'assistant', content: thinkContent })
          for (const tc of results.toolCalls) {
            state.messages.push({
              role: 'tool',
              content: JSON.stringify({ tool: tc.name, result: tc.result }),
            })
          }

          yield { event: 'on_chain_end', name: 'observe', data: { toolCalls: results.toolCalls.length } }
        } catch (err) {
          yield { event: 'on_error', data: { message: (err as Error).message } }
          state.status = 'error'
          break
        }
      } else {
        state.currentNode = 'answer'

        // ── Harness ③: 输出 Guardrail（answer 前） ──
        const { result: guardResult, sanitized } = checkOutputGuardrail(thinkContent)
        yield { event: 'on_harness_check', data: guardResult }
        if (guardResult.result === 'block') {
          state.status = 'error'
          state.lastAnswer = sanitized
        } else {
          state.lastAnswer = sanitized
        }

        state.messages.push({ role: 'assistant', content: state.lastAnswer })

        yield { event: 'on_chain_start', name: 'answer' }
        yield { event: 'on_chain_end', name: 'answer', data: { content: state.lastAnswer } }

        state.status = guardResult.result === 'block' ? 'error' : 'completed'
      }

      persistState(state)
    }

    if (state.status === 'running') {
      state.status = 'completed'
      persistState(state)
    }

    yield {
      event: 'on_chain_end',
      name: 'Agent',
      data: { status: state.status, iterations: state.iteration, answer: state.lastAnswer },
      metadata: { threadId },
    }
  }

  async function run(threadId: string, userInput: string): Promise<AgentState> {
    let lastState: AgentState | null = null
    for await (const event of streamEvents(threadId, userInput)) {
      if (event.event === 'on_chain_end' && event.name === 'Agent') {
        lastState = getState(threadId)
      }
    }
    return lastState || getState(threadId)
  }

  function rollback(threadId: string, step: number): AgentState {
    const state = getState(threadId)
    state.messages = state.messages.slice(0, step * 2 + 1)
    state.toolCalls = state.toolCalls.slice(0, step)
    state.status = 'idle'
    state.iteration = step
    persistState(state)
    return state
  }

  function pause(threadId: string): AgentState {
    const state = getState(threadId)
    state.status = 'paused'
    persistState(state)
    return state
  }

  function resume(threadId: string, userInput: string): AsyncGenerator<AgentStreamEvent> {
    const state = getState(threadId)
    state.status = 'running'
    return streamEvents(threadId, userInput, state)
  }

  return { streamEvents, run, rollback, pause, resume }
}
