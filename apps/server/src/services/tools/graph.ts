/**
 * 工具 Agent 图 — spec 阶段 4（Task 4 / AC-5）
 *
 *   decide ─┬→ finish（模型直接回答）
 *           └→ execute → decide …（回环；每轮 execute 后由框架落检查点）
 *                         └→ summarize → finish（达到轮数上限）
 *
 * 与旧循环的差异只在编排层：节点内部继续调用同一个模型与工具，
 * `ENABLE_GRAPH_AGENT=1` 时才启用；默认仍走 `agent.ts` 的 for 循环。
 *
 * 恢复：已完成的工具调用记录在 `messages` + `steps` 两个通道里，
 * 进程中断后调用 `resumeToolAgentGraph(threadId)` 从最后一个检查点续跑，不会重放工具。
 */

import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { randomUUID } from 'crypto'

import type { ModelToolCall, ToolCallMessage } from '../chain/model.js'
import { compileGraph, tracedNode } from '../graph/runtime.js'
import { ANON_SESSION, agentThreadId } from '../graph/thread.js'
import type { GraphNode } from '../graph/types.js'
import { logger } from '../logger.js'
import {
  executeCall,
  resolveToolAgentDeps,
  TOOL_SYSTEM,
  type ResolvedToolAgentDeps,
  type ToolAgentOptions,
  type ToolAgentOutcome,
  type ToolExecution,
} from './agent.js'

const AgentState = Annotation.Root({
  messages: Annotation<ToolCallMessage[]>(),
  steps: Annotation<ToolExecution[]>(),
  /** 已完成的工具轮数 */
  iteration: Annotation<number>(),
  /** 本轮待执行的工具调用 */
  pendingCalls: Annotation<ModelToolCall[]>(),
  /** 非 null 表示已产出最终回答，图可结束 */
  finalContent: Annotation<string | null>(),
  reachedMaxIterations: Annotation<boolean>(),
})

export type AgentGraphState = typeof AgentState.State

/** 条件边：decide → execute | finish */
export const routeAfterDecide = (
  state: Pick<AgentGraphState, 'finalContent'>,
): 'execute' | 'finish' => (state.finalContent === null ? 'execute' : 'finish')

/** 条件边：execute → summarize | decide */
export const shouldSummarize = (iteration: number, maxIterations: number): boolean =>
  iteration >= maxIterations

const createDecideNode =
  (deps: ResolvedToolAgentDeps): GraphNode<AgentGraphState> =>
  async (state) => {
    const response = await deps.invoke(state.messages, 'auto')
    if (response.toolCalls.length === 0) {
      return {
        finalContent: response.content.trim() || '模型没有返回文字回答，请再试一次。',
      }
    }

    return {
      messages: [
        ...state.messages,
        { role: 'assistant', content: response.content, tool_calls: response.toolCalls },
      ],
      pendingCalls: response.toolCalls,
    }
  }

const createExecuteNode =
  (deps: ResolvedToolAgentDeps): GraphNode<AgentGraphState> =>
  async (state) => {
    const iteration = state.iteration + 1
    // 同一轮的多个工具调用没有顺序依赖，统一并行执行，再按原顺序回注。
    const executions = await Promise.all(
      state.pendingCalls.map((call) => executeCall(call, deps.tools)),
    )
    const messages = [...state.messages]
    const steps = [...state.steps]

    for (const execution of executions) {
      steps.push(execution.step)
      messages.push({
        role: 'tool',
        tool_call_id: execution.call.id,
        name: execution.call.function.name,
        content: execution.output,
      })
      logger.info('tools.agent', '工具执行完成', {
        name: execution.step.name,
        ok: execution.step.ok,
        iteration,
        error: execution.step.error,
      })
    }

    return { messages, steps, pendingCalls: [], iteration }
  }

const createSummarizeNode =
  (deps: ResolvedToolAgentDeps): GraphNode<AgentGraphState> =>
  async (state) => {
    // 达到上限后禁止继续调工具，让模型基于已有结果总结，避免死循环。
    const response = await deps.invoke(state.messages, 'none')
    return {
      finalContent: response.content.trim() || '工具调用已完成，但模型没有生成最终回答。',
      reachedMaxIterations: true,
    }
  }

/** 终点：不做事，仅让条件边汇合到 END */
const finishNode: GraphNode<AgentGraphState> = () => ({})

export const buildAgentGraph = (deps: ResolvedToolAgentDeps) =>
  new StateGraph(AgentState)
    .addNode('decide', tracedNode<AgentGraphState>('agent', 'decide', createDecideNode(deps)))
    .addNode('execute', tracedNode<AgentGraphState>('agent', 'execute', createExecuteNode(deps)))
    .addNode(
      'summarize',
      tracedNode<AgentGraphState>('agent', 'summarize', createSummarizeNode(deps)),
    )
    .addNode('finish', tracedNode<AgentGraphState>('agent', 'finish', finishNode))
    .addEdge(START, 'decide')
    .addConditionalEdges('decide', routeAfterDecide, ['execute', 'finish'])
    .addConditionalEdges(
      'execute',
      (state: AgentGraphState) =>
        shouldSummarize(state.iteration, deps.maxIterations) ? 'summarize' : 'decide',
      ['summarize', 'decide'],
    )
    .addEdge('summarize', 'finish')
    .addEdge('finish', END)

const threadConfig = (threadId: string) => ({ configurable: { thread_id: threadId } })

const toOutcome = (values: AgentGraphState, threadId: string): ToolAgentOutcome => ({
  content: values.finalContent ?? '工具调用已完成，但模型没有生成最终回答。',
  steps: values.steps ?? [],
  reachedMaxIterations: values.reachedMaxIterations ?? false,
  threadId,
})

/** 图模式入口：与 `runToolAgent` 同签名，返回额外带上 threadId */
export const runToolAgentGraph = async (options: ToolAgentOptions): Promise<ToolAgentOutcome> => {
  const deps = resolveToolAgentDeps(options)
  const threadId =
    options.threadId ??
    agentThreadId(
      options.sessionId?.trim() || ANON_SESSION,
      options.messageId?.trim() || randomUUID(),
    )
  const graph = await compileGraph(buildAgentGraph(deps))
  const config = threadConfig(threadId)

  await graph.invoke(
    {
      messages: [
        { role: 'system', content: options.systemPrompt ?? TOOL_SYSTEM },
        ...options.messages,
      ],
      steps: [],
      iteration: 0,
      pendingCalls: [],
      finalContent: null,
      reachedMaxIterations: false,
    },
    config,
  )

  const snapshot = await graph.getState(config)
  return toOutcome(snapshot.values as AgentGraphState, threadId)
}

export interface ToolAgentResumeOptions extends Omit<ToolAgentOptions, 'messages'> {
  threadId: string
}

/**
 * 从检查点续跑。`null` 表示该 thread 已无待执行节点（正常结束或从未开始）。
 * 已完成的工具调用在 `messages`/`steps` 中，恢复后只会执行剩余轮次。
 */
export const resumeToolAgentGraph = async (
  options: ToolAgentResumeOptions,
): Promise<ToolAgentOutcome | null> => {
  const deps = resolveToolAgentDeps(options)
  const graph = await compileGraph(buildAgentGraph(deps))
  const config = threadConfig(options.threadId)

  const before = await graph.getState(config)
  if (!before.next || before.next.length === 0) return null

  await graph.invoke(null, config)

  const after = await graph.getState(config)
  return toOutcome(after.values as AgentGraphState, options.threadId)
}
