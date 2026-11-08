/**
 * pricing 单价表单元测试（使用仓库真实 config/models.json）
 */
import { describe, it, expect } from 'vitest'
import { estimateCostYuan, isFreeModel } from '../pricing.js'

describe('isFreeModel', () => {
  it('glm-4-flash 是免费模型', () => {
    expect(isFreeModel('zhipu', 'glm-4-flash')).toBe(true)
  })

  it('glm-4-plus 是付费模型', () => {
    expect(isFreeModel('zhipu', 'glm-4-plus')).toBe(false)
  })

  it('未知模型保守按付费处理', () => {
    expect(isFreeModel('zhipu', 'no-such-model')).toBe(false)
    expect(isFreeModel('openai', 'gpt-4o')).toBe(false)
  })
})

describe('estimateCostYuan', () => {
  it('免费模型成本为 0', () => {
    expect(estimateCostYuan('zhipu', 'glm-4-flash', 100_000, 50_000)).toBe(0)
  })

  it('按单价表计算（glm-4-plus：输入 50 元/1M，输出 50 元/1M）', () => {
    expect(estimateCostYuan('zhipu', 'glm-4-plus', 1_000_000, 500_000)).toBeCloseTo(75, 6)
  })

  it('未知模型返回 null（无法估算）', () => {
    expect(estimateCostYuan('zhipu', 'no-such-model', 100, 100)).toBeNull()
  })
})
