import { afterEach, describe, expect, it } from 'vitest'

import { isRouterEnabled, routeModel } from '../router.js'
import { scoreComplexity } from '../../search/complexity.js'

afterEach(() => {
  delete process.env.LLM_ROUTER
})

describe('scoreComplexity', () => {
  it('简单问题得 0 分', () => {
    expect(scoreComplexity('你好').score).toBe(0)
  })

  it('多意图 + 时间表达累计加分', () => {
    const result = scoreComplexity('上周的安排是什么？这周还有什么没做？')
    expect(result.signals.multiIntent).toBe(true)
    expect(result.signals.temporal).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(2)
  })

  it('多个并列实体加分', () => {
    const result = scoreComplexity('对比《方案A》、《方案B》和「方案C」')
    expect(result.signals.entityCount).toBeGreaterThanOrEqual(2)
  })
})

describe('routeModel', () => {
  it('抽取类固定小模型', () => {
    expect(routeModel({ step: 'extract' }).tier).toBe('small')
    expect(routeModel({ step: 'rerank' }).tier).toBe('small')
  })

  it('个人上下文回答走大模型', () => {
    expect(
      routeModel({ step: 'chat', query: '我明天有什么安排', needsPersonalContext: true }).tier,
    ).toBe('large')
  })

  it('简单通用问题走小模型', () => {
    expect(routeModel({ step: 'chat', query: '你好', needsPersonalContext: false }).tier).toBe(
      'small',
    )
  })

  it('高复杂度通用问题升级大模型', () => {
    const decision = routeModel({
      step: 'chat',
      query: '帮我把上周的进度和这周的安排分别汇总一下？另外还要对比两版方案？',
      needsPersonalContext: false,
    })
    expect(decision.complexity).toBeGreaterThanOrEqual(2)
    expect(decision.tier).toBe('large')
    expect(decision.reason).toBe('complexity_large')
  })

  it('工具意图优先走大模型', () => {
    expect(routeModel({ step: 'chat', toolIntent: true }).tier).toBe('large')
  })

  it('LLM_ROUTER=0 时保留调用点原档位', () => {
    process.env.LLM_ROUTER = '0'
    expect(isRouterEnabled()).toBe(false)
    const decision = routeModel({
      step: 'chat',
      needsPersonalContext: true,
      configuredTier: 'large',
    })
    expect(decision.enabled).toBe(false)
    expect(decision.tier).toBe('large')
    expect(decision.reason).toBe('router_disabled')
  })
})
