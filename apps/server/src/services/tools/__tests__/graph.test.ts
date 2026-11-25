/**
 * 工具 Agent 图单测 — Task 4 / AC-5 / AC-6
 *
 * 覆盖：工具轮次、达到上限走 summarize、失败后从检查点恢复且不重放已执行工具。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, resetTestDatabase } from '../../../../tests/helpers/db.js'

import type { ModelToolCall, ToolCallMessage, ToolCallResult } from '../../chain/model.js'
import type { CommonTool } from '../index.js'

let agentGraph: typeof import('../graph.js')

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

beforeAll(async () => {
  agentGraph = await import('../graph.js')
})

beforeEach(resetTestDatabase)
afterAll(closeTestDatabase)

describe('工具 Agent 图', () => {
  it('执行一轮工具后生成最终回答', async () => {
    const invoke = async (
      _messages: ToolCallMessage[],
      toolChoice: 'auto' | 'none',
    ): Promise<ToolCallResult> => {
      if (toolChoice === 'none') return { content: '总结', toolCalls: [] }
      const hasTool = _messages.some((message) => message.role === 'tool')
      return hasTool
        ? { content: '现在是北京时间 10:00。', toolCalls: [] }
        : { content: '', toolCalls: [call('time-1', 'get_current_datetime')] }
    }

    const outcome = await agentGraph.runToolAgentGraph({
      messages: [{ role: 'user', content: '现在几点' }],
      tools: [
        { ...stubTool('get_current_datetime', async () => '{"now":"2026-11-13T02:00:00Z"}') },
      ],
      invoke,
      maxIterations: 4,
      threadId: 'agent:test:round-1',
    })

    expect(outcome.content).toContain('10:00')
    expect(outcome.steps).toEqual([{ name: 'get_current_datetime', ok: true }])
    expect(outcome.reachedMaxIterations).toBe(false)
    expect(outcome.threadId).toBe('agent:test:round-1')
  })

  it('达到轮数上限后用 toolChoice=none 强制总结', async () => {
    const choices: string[] = []
    const invoke = async (
      _messages: ToolCallMessage[],
      toolChoice: 'auto' | 'none',
    ): Promise<ToolCallResult> => {
      choices.push(toolChoice)
      if (toolChoice === 'none') return { content: '根据已有结果总结', toolCalls: [] }
      return { content: '', toolCalls: [call('time-1', 'get_current_datetime')] }
    }

    const outcome = await agentGraph.runToolAgentGraph({
      messages: [{ role: 'user', content: '现在时间' }],
      tools: [stubTool('get_current_datetime', async () => '{"now":"..."}')],
      invoke,
      maxIterations: 1,
      threadId: 'agent:test:max-1',
    })

    expect(outcome.reachedMaxIterations).toBe(true)
    expect(outcome.content).toBe('根据已有结果总结')
    expect(choices).toEqual(['auto', 'none'])
  })

  it('中断后从检查点恢复，不重复执行已完成的工具', async () => {
    const threadId = 'agent:test:resume-1'
    let toolRuns = 0
    const flakyTool = stubTool('flaky_tool', async () => {
      toolRuns++
      return JSON.stringify({ ok: true })
    })

    let decides = 0
    const crashingInvoke = async (
      _messages: ToolCallMessage[],
      toolChoice: 'auto' | 'none',
    ): Promise<ToolCallResult> => {
      if (toolChoice === 'none') return { content: '总结', toolCalls: [] }
      decides++
      if (decides === 1) return { content: '', toolCalls: [call('resume-1', 'flaky_tool')] }
      // 模拟第二决策轮进程中断
      throw new Error('boom')
    }

    await expect(
      agentGraph.runToolAgentGraph({
        messages: [{ role: 'user', content: '调用工具' }],
        tools: [flakyTool],
        invoke: crashingInvoke,
        maxIterations: 4,
        threadId,
      }),
    ).rejects.toThrow('boom')
    expect(toolRuns).toBe(1)

    const resumed = await agentGraph.resumeToolAgentGraph({
      threadId,
      tools: [flakyTool],
      invoke: async () => ({ content: '恢复后的最终回答', toolCalls: [] }),
      maxIterations: 4,
    })

    expect(resumed?.content).toBe('恢复后的最终回答')
    expect(resumed?.steps).toHaveLength(1)
    expect(toolRuns).toBe(1)
  })

  it('无待执行节点时 resume 返回 null', async () => {
    const resumed = await agentGraph.resumeToolAgentGraph({
      threadId: 'agent:test:not-started',
      tools: [stubTool('noop', async () => '{}')],
      invoke: async () => ({ content: '不应被调用', toolCalls: [] }),
    })
    expect(resumed).toBeNull()
  })
})
