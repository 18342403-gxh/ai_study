/** 工具 Agent：模型决策 → 并行执行工具 → 结果回注 → 最终回答。 */

import {
  invokeChatWithToolCalls,
  type ChatMessage,
  type ModelToolCall,
  type ToolCallMessage,
  type ToolCallResult,
} from '../chain/model.js'
import type { AiFeature } from '../costTracker.js'
import { logger } from '../logger.js'
import { recordGuardDecision } from '../../middleware/metrics.js'
import { withSpan } from '../../observability/tracing.js'
import { guardToolOutput } from '../guard/toolGuard.js'
import { isGraphEnabled } from '../graph/runtime.js'
import { createCommonTools, toFunctionToolDefinitions, type CommonTool } from './index.js'

export const TOOL_SYSTEM = `你是工具编排 Agent。根据用户问题决定是否需要调用工具。
规则：
1. 当前时间、实时天气、最新新闻、网页内容、外部实时事实，必须调用相应工具，不得凭记忆编造。
2. 复杂数学计算使用 calculator；用户提供网页地址并要求阅读时使用 fetch_url。
3. 多个相互独立的查询可以在同一轮发起，系统会并行执行。
4. 工具返回空结果或错误时如实说明，不得虚构结果；无日期的新闻不得自行补日期。
5. 搜索和新闻回答保留关键来源的 Markdown 链接；天气回答说明数据来自 wttr.in。
6. 不需要工具时直接回答。涉及个人记录时，仍须遵守原 system 消息中的引用与“不推测”规则。`

export interface ToolExecution {
  name: string
  ok: boolean
  error?: string
  /** 工具结果守卫决策：wrap 表示命中注入特征已包裹 */
  guard?: 'wrap'
}

export interface ToolAgentOutcome {
  content: string
  steps: ToolExecution[]
  /** true 表示达到工具轮数上限后又做了一次无工具总结。 */
  reachedMaxIterations: boolean
  /** 图模式下本次运行的 thread_id，用于中断/重启后续跑 */
  threadId?: string
}

export interface ToolAgentOptions {
  messages: ChatMessage[]
  feature?: AiFeature
  /** 覆盖默认 TOOL_SYSTEM（规划等专用 agent 使用） */
  systemPrompt?: string
  /** 模型档位：工具循环默认走大模型（由 router 决策） */
  tier?: 'small' | 'large'
  tools?: CommonTool[]
  maxIterations?: number
  /** 测试注入模型；生产默认走 GLM Function Calling。 */
  invoke?: (messages: ToolCallMessage[], toolChoice: 'auto' | 'none') => Promise<ToolCallResult>
  /** 图模式下的会话标识；缺省时按匿名会话处理 */
  sessionId?: string
  /** 图模式下的消息标识；缺省时随机生成，仅用于落检查点 */
  messageId?: string
  /** 图模式下显式指定 thread_id（恢复时复用） */
  threadId?: string
}

/** 默认开启，ENABLE_TOOLS=0 可整体关闭并恢复原有纯模型对话。 */
export const areToolsEnabled = (): boolean => process.env.ENABLE_TOOLS !== '0'

/** 明确的外部信息问题可绕过“个人知识库无结果”的固定话术。 */
export const isExplicitToolQuery = (query: string): boolean =>
  /天气|气温|下雨|降雪|新闻|头条|热点|联网搜索|网页搜索|搜索一下|网上查|https?:\/\//i.test(query) ||
  /(?:现在|当前).*(?:时间|几点|日期)|今天.*(?:几号|星期|日期|发生|消息)/.test(query) ||
  /最新.*(?:消息|新闻|资讯|动态|版本|价格|发布)/.test(query) ||
  /(?:计算|算一下|等于多少)/.test(query) ||
  /^[\d\s()+*/%.-]+[*/%+-][\d\s()+*/%.-]+$/.test(query)

const parseArguments = (raw: string): Record<string, unknown> => {
  const parsed = JSON.parse(raw || '{}') as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('工具参数必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

export const executeCall = async (
  call: ModelToolCall,
  tools: CommonTool[],
): Promise<{ call: ModelToolCall; output: string; step: ToolExecution }> => {
  const tool = tools.find((item) => item.name === call.function.name)
  if (!tool) {
    const error = `未知工具：${call.function.name}`
    return {
      call,
      output: JSON.stringify({ error }),
      step: { name: call.function.name, ok: false, error },
    }
  }

  try {
    const args = parseArguments(call.function.arguments)
    const output = await withSpan(
      'tool.execute',
      { 'tool.name': tool.name, 'app.tool': tool.name },
      () => tool.invoke(args),
    )
    const truncated =
      output.length > 24_000 ? `${output.slice(0, 24_000)}\n[工具结果已截断]` : output
    // 工具结果守卫：命中提示注入特征时包裹并标注 risk=high，不丢弃
    const guard = guardToolOutput(tool.name, truncated)
    recordGuardDecision(guard.action, 'tool')
    return {
      call,
      output: guard.text,
      step: { name: tool.name, ok: true, guard: guard.risk === 'high' ? 'wrap' : undefined },
    }
  } catch (error) {
    const message = (error as Error).message
    return {
      call,
      output: JSON.stringify({ error: message }),
      step: { name: tool.name, ok: false, error: message },
    }
  }
}

export interface ResolvedToolAgentDeps {
  tools: CommonTool[]
  invoke: (messages: ToolCallMessage[], toolChoice: 'auto' | 'none') => Promise<ToolCallResult>
  maxIterations: number
}

/** 解析工具、模型调用与轮数上限；旧循环与工具图共用，保证行为一致 */
export const resolveToolAgentDeps = (
  options: Omit<ToolAgentOptions, 'messages'>,
): ResolvedToolAgentDeps => {
  const tools = options.tools ?? createCommonTools()
  const definitions = toFunctionToolDefinitions(tools)
  const invoke =
    options.invoke ??
    ((messages: ToolCallMessage[], toolChoice: 'auto' | 'none') =>
      invokeChatWithToolCalls(
        { temperature: 0.2, feature: options.feature ?? 'chat_general', tier: options.tier },
        messages,
        definitions,
        toolChoice,
      ))
  const configuredMax = Number.parseInt(process.env.TOOL_MAX_ITERATIONS || '4', 10) || 4
  const maxIterations = Math.min(6, Math.max(1, options.maxIterations ?? configuredMax))
  return { tools, invoke, maxIterations }
}

export const runToolAgent = async (options: ToolAgentOptions): Promise<ToolAgentOutcome> => {
  // ── 图模式：decide / execute / summarize，每轮落检查点（ENABLE_GRAPH_AGENT=1） ──
  if (isGraphEnabled('agent')) {
    const { runToolAgentGraph } = await import('./graph.js')
    return runToolAgentGraph(options)
  }

  const { tools, invoke, maxIterations } = resolveToolAgentDeps(options)
  const messages: ToolCallMessage[] = [
    { role: 'system', content: options.systemPrompt ?? TOOL_SYSTEM },
    ...options.messages,
  ]
  const steps: ToolExecution[] = []

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const response = await invoke(messages, 'auto')
    if (response.toolCalls.length === 0) {
      return {
        content: response.content.trim() || '模型没有返回文字回答，请再试一次。',
        steps,
        reachedMaxIterations: false,
      }
    }

    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.toolCalls,
    })
    // 同一轮的多个工具调用没有顺序依赖，统一并行执行，再按原顺序回注。
    const executions = await Promise.all(response.toolCalls.map((call) => executeCall(call, tools)))
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
  }

  // 达到上限后禁止继续调工具，让模型基于已有结果总结，避免死循环。
  const finalResponse = await invoke(messages, 'none')
  return {
    content: finalResponse.content.trim() || '工具调用已完成，但模型没有生成最终回答。',
    steps,
    reachedMaxIterations: true,
  }
}
