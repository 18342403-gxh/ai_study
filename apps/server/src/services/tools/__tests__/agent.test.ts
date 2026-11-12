import { describe, expect, it, vi } from 'vitest'

import type { ModelToolCall, ToolCallMessage } from '../../chain/model.js'
import { isExplicitToolQuery, runToolAgent } from '../agent.js'
import { createCommonTools, type CommonTool } from '../index.js'

const call = (id: string, name: string, args: Record<string, unknown> = {}): ModelToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

const stubTool = (
  name: string,
  invoke: (args: Record<string, unknown>) => Promise<string>,
): CommonTool => ({
  name,
  description: `${name} 测试工具`,
  parameters: { type: 'object', properties: {} },
  invoke,
})

describe('runToolAgent', () => {
  it('无需工具时直接返回模型回答', async () => {
    const outcome = await runToolAgent({
      messages: [{ role: 'user', content: '你好' }],
      invoke: async () => ({ content: '你好，有什么可以帮你？', toolCalls: [] }),
    })
    expect(outcome.content).toBe('你好，有什么可以帮你？')
    expect(outcome.steps).toEqual([])
  })

  it('执行时间工具后回注 tool_call_id 并生成最终回答', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [call('time-1', 'get_current_datetime', { timezone: 'Asia/Shanghai' })],
      })
      .mockImplementationOnce(async (messages: ToolCallMessage[]) => {
        const toolMessage = messages.find((message) => message.role === 'tool')
        expect(toolMessage).toMatchObject({ tool_call_id: 'time-1', name: 'get_current_datetime' })
        expect(toolMessage?.content).toContain('2026-11-13T02:00:00.000Z')
        return { content: '现在是北京时间 2026-11-13 10:00。', toolCalls: [] }
      })

    const outcome = await runToolAgent({
      messages: [{ role: 'user', content: '现在几点' }],
      tools: createCommonTools({ now: () => new Date('2026-11-13T02:00:00Z') }),
      invoke,
    })
    expect(outcome.content).toContain('10:00')
    expect(outcome.steps).toEqual([{ name: 'get_current_datetime', ok: true }])
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('同一轮的独立工具调用并行执行', async () => {
    let active = 0
    let maxActive = 0
    const invokeTool = async (name: string): Promise<string> => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active--
      return JSON.stringify({ name })
    }
    const tools = [
      stubTool('tool_a', () => invokeTool('a')),
      stubTool('tool_b', () => invokeTool('b')),
    ]
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [call('a1', 'tool_a'), call('b1', 'tool_b')],
      })
      .mockResolvedValueOnce({ content: '两个工具都完成了', toolCalls: [] })

    const outcome = await runToolAgent({
      messages: [{ role: 'user', content: '并行查询' }],
      tools,
      invoke,
    })
    expect(maxActive).toBe(2)
    expect(outcome.steps.map((step) => step.name)).toEqual(['tool_a', 'tool_b'])
  })

  it('工具异常作为结果回注，而不是让整次对话崩溃', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [call('calc-1', 'calculator', { expression: '1/0' })],
      })
      .mockImplementationOnce(async (messages: ToolCallMessage[]) => {
        const toolMessage = messages.find((message) => message.role === 'tool')
        expect(toolMessage?.content).toContain('除数不能为 0')
        return { content: '这个算式无法计算，因为除数为 0。', toolCalls: [] }
      })
    const outcome = await runToolAgent({
      messages: [{ role: 'user', content: '计算 1/0' }],
      tools: createCommonTools(),
      invoke,
    })
    expect(outcome.steps[0]).toMatchObject({ name: 'calculator', ok: false })
    expect(outcome.content).toContain('除数为 0')
  })

  it('达到轮数上限后用 toolChoice=none 强制总结', async () => {
    const choices: string[] = []
    const invoke = vi.fn(async (_messages: ToolCallMessage[], toolChoice: 'auto' | 'none') => {
      choices.push(toolChoice)
      if (toolChoice === 'none') return { content: '根据已有结果总结', toolCalls: [] }
      return { content: '', toolCalls: [call('time-1', 'get_current_datetime')] }
    })
    const outcome = await runToolAgent({
      messages: [{ role: 'user', content: '现在时间' }],
      tools: createCommonTools(),
      maxIterations: 1,
      invoke,
    })
    expect(outcome.reachedMaxIterations).toBe(true)
    expect(outcome.content).toBe('根据已有结果总结')
    expect(choices).toEqual(['auto', 'none'])
  })
})

describe('isExplicitToolQuery', () => {
  it('识别天气、新闻、当前时间和网页问题', () => {
    expect(isExplicitToolQuery('今天天气怎么样')).toBe(true)
    expect(isExplicitToolQuery('看看最新新闻')).toBe(true)
    expect(isExplicitToolQuery('现在几点')).toBe(true)
    expect(isExplicitToolQuery('读取 https://example.com')).toBe(true)
    expect(isExplicitToolQuery('我明天有什么安排')).toBe(false)
  })
})
