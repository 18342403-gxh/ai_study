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
import { createCommonTools, toFunctionToolDefinitions, type CommonTool } from './index.js'

const TOOL_SYSTEM = `你是工具编排 Agent。根据用户问题决定是否需要调用工具。
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
}

export interface ToolAgentOutcome {
  content: string
  steps: ToolExecution[]
  /** true 表示达到工具轮数上限后又做了一次无工具总结。 */
  reachedMaxIterations: boolean
}

export interface ToolAgentOptions {
  messages: ChatMessage[]
  feature?: AiFeature
  tools?: CommonTool[]
  maxIterations?: number
  /** 测试注入模型；生产默认走 GLM Function Calling。 */
  invoke?: (messages: ToolCallMessage[], toolChoice: 'auto' | 'none') => Promise<ToolCallResult>
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

const executeCall = async (
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
    const output = await tool.invoke(args)
    return {
      call,
      output: output.length > 24_000 ? `${output.slice(0, 24_000)}\n[工具结果已截断]` : output,
      step: { name: tool.name, ok: true },
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

export const runToolAgent = async (options: ToolAgentOptions): Promise<ToolAgentOutcome> => {
  const tools = options.tools ?? createCommonTools()
  const definitions = toFunctionToolDefinitions(tools)
  const invoke =
    options.invoke ??
    ((messages: ToolCallMessage[], toolChoice: 'auto' | 'none') =>
      invokeChatWithToolCalls(
        { temperature: 0.2, feature: options.feature ?? 'chat_general' },
        messages,
        definitions,
        toolChoice,
      ))
  const configuredMax = Number.parseInt(process.env.TOOL_MAX_ITERATIONS || '4', 10) || 4
  const maxIterations = Math.min(6, Math.max(1, options.maxIterations ?? configuredMax))
  const messages: ToolCallMessage[] = [
    { role: 'system', content: TOOL_SYSTEM },
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
