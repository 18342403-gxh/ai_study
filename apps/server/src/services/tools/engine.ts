/**
 * Function Calling 执行引擎
 * 将 LLM 的 tool_calls 循环 + 执行 + 喂回上下文
 */

import { createChatChain, type ChatRequest } from '../chain/chatChain.js'
import { getTool, getAllTools, getToolsByWhitelist, executeTool } from './registerTools.js'
import { z } from 'zod'

export interface FunctionCallingOptions {
  allowedToolIds?: string[]
  maxIterations?: number
  temperature?: number
  systemPrompt?: string
  context?: { sessionId?: string }
}

export interface FunctionCallEvent {
  type: 'tool_call_start' | 'tool_call_result' | 'assistant_delta' | 'assistant_complete' | 'iteration' | 'error'
  data?: unknown
  toolName?: string
  iteration?: number
}

/**
 * 创建 Function Calling 执行引擎
 * 模拟 LangChain createStructuredTool 的循环
 */
export function createFunctionCallingEngine(options: FunctionCallingOptions = {}) {
  const maxIter = options.maxIterations || 5
  const allowedIds = options.allowedToolIds

  return {
    /**
     * 流式执行：返回 AsyncGenerator 事件
     */
    async *stream(
      initialMessages: Array<{ role: string; content: string }>,
      userInput?: string
    ): AsyncGenerator<FunctionCallEvent> {
      let messages = [...initialMessages]
      if (userInput) {
        messages.push({ role: 'user', content: userInput })
      }

      // 注入 system prompt
      if (options.systemPrompt) {
        messages = [{ role: 'system', content: options.systemPrompt }, ...messages]
      }

      const chain = createChatChain({ temperature: options.temperature ?? 0.7 })
      const tools = allowedIds ? getToolsByWhitelist(allowedIds) : getAllTools()

      for (let i = 0; i < maxIter; i++) {
        yield { type: 'iteration', data: { iteration: i + 1 } }

        const toolDescriptions = tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.schema._def,
        }))

        const enhancedMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [
          ...messages as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
          {
            role: 'system',
            content: `你可以使用以下工具：\n${JSON.stringify(toolDescriptions, null, 2)}\n\n如果需要调用工具，在回复中使用格式：\n[TOOL_CALL] { "name": "工具名", "args": {...} } [/TOOL_CALL]`,
          },
        ]

        // 流式调用 LLM
        let fullContent = ''
        let toolCallDetected = false

        try {
          for await (const delta of chain.stream({ messages: enhancedMessages, stream: true })) {
            fullContent += delta
            yield { type: 'assistant_delta', data: delta }

            // 检测工具调用标记
            const match = fullContent.match(/\[TOOL_CALL\]\s*(.+?)\s*\[\/TOOL_CALL\]/s)
            if (match) {
              toolCallDetected = true
              try {
                const parsed = JSON.parse(match[1])
                const tool = getTool(parsed.name)
                if (!tool) {
                  yield { type: 'error', data: { message: `工具 ${parsed.name} 不存在` } }
                  continue
                }

                yield { type: 'tool_call_start', toolName: parsed.name, iteration: i + 1 }

                const result = await executeTool(
                  parsed.name,
                  parsed.args || {},
                  options.context
                )

                yield {
                  type: 'tool_call_result',
                  toolName: parsed.name,
                  data: result,
                  iteration: i + 1,
                }

                messages.push({ role: 'assistant', content: fullContent })
                messages.push({
                  role: 'tool',
                  content: JSON.stringify({ tool: parsed.name, result }),
                })
                break
              } catch (err) {
                yield { type: 'error', data: { message: (err as Error).message } }
                break
              }
            }
          }
        } catch (err) {
          yield { type: 'error', data: { message: (err as Error).message } }
          break
        }

        if (!toolCallDetected) {
          yield { type: 'assistant_complete', data: fullContent }
          break
        }
      }
    },

    /**
     * 非流式执行
     */
    async run(
      initialMessages: Array<{ role: string; content: string }>,
      userInput?: string
    ): Promise<{ content: string; toolCalls: Array<{ name: string; args: unknown; result: unknown }> }> {
      const events = this.stream(initialMessages, userInput)
      let content = ''
      const toolCalls: Array<{ name: string; args: unknown; result: unknown }> = []

      for await (const event of events) {
        if (event.type === 'assistant_delta') {
          content += event.data as string
        } else if (event.type === 'tool_call_result') {
          toolCalls.push({
            name: event.toolName!,
            args: event.data as unknown,
            result: event.data,
          })
        }
      }

      return { content, toolCalls }
    },
  }
}
