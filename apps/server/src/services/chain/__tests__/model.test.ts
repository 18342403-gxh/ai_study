/**
 * model.ts 单元测试
 *   - resolveModelName：小/大模型路由（纯函数）
 *   - 429 / 余额不足 → 全局 degraded 标记；成功后自动清除
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  createChatModel,
  resolveModelName,
  isChatDegraded,
  getChatDegradedState,
  resetChatDegraded,
} from '../model.js'

const ENV = {
  apiUrl: 'https://example.invalid/v4',
  apiKey: 'k',
  defaultModel: 'glm-4-flash',
  largeModel: 'glm-4-plus',
}

afterEach(() => {
  resetChatDegraded()
  vi.unstubAllGlobals()
})

describe('resolveModelName', () => {
  it('显式 model 优先', () => {
    expect(resolveModelName({ model: 'custom' }, ENV)).toBe('custom')
  })

  it('tier=large 走 AI_MODEL_LARGE', () => {
    expect(resolveModelName({ tier: 'large' }, ENV)).toBe('glm-4-plus')
  })

  it('tier=large 但未配置大模型 → 回退默认免费档', () => {
    expect(resolveModelName({ tier: 'large' }, { ...ENV, largeModel: '' })).toBe('glm-4-flash')
  })

  it('默认走免费档', () => {
    expect(resolveModelName({}, ENV)).toBe('glm-4-flash')
  })
})

describe('429/余额不足降级标记', () => {
  it('429 → 置 degraded 标记', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limit exceeded' })),
    )
    const model = createChatModel({ model: 'glm-4-flash' })
    await expect(model.invoke([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'AI 请求失败 (429)',
    )
    expect(isChatDegraded()).toBe(true)
    expect(getChatDegradedState().reason).toContain('429')
  })

  it('余额不足（1113）→ 置 degraded 标记', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => '{"error":{"code":"1113","message":"余额不足"}}',
      })),
    )
    const model = createChatModel({ model: 'glm-4-flash' })
    await expect(model.invoke('hi')).rejects.toThrow('AI 请求失败')
    expect(isChatDegraded()).toBe(true)
  })

  it('普通 500 不置标记；成功后清除标记', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'internal error' })),
    )
    const model = createChatModel({ model: 'glm-4-flash' })
    await expect(model.invoke('hi')).rejects.toThrow('AI 请求失败 (500)')
    expect(isChatDegraded()).toBe(false)

    await markDegradedExternally()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '好的' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      })),
    )
    const content = await model.invoke([{ role: 'user', content: 'hi' }])
    expect(content).toBe('好的')
    expect(isChatDegraded()).toBe(false)
  })
})

/** 通过一次 429 失败把标记置上（模拟之前的降级状态） */
async function markDegradedExternally(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limit' })),
  )
  const m = createChatModel({ model: 'glm-4-flash' })
  await m.invoke('x').catch(() => {})
  expect(isChatDegraded()).toBe(true)
}
