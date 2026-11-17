/**
 * 规则版模型路由（P0 · R1/R2/R3）
 *
 * 目标：在不改变外部行为的前提下，把“预处理/抽取”类调用固定到小模型，
 * 把“个人上下文回答/工具循环/高复杂度问题”升级到大模型。
 *
 * 开关：LLM_ROUTER=0 关闭（默认开启）。关闭时回退调用点原有档位。
 * R3：每次决策都记录 step/tier/原因/复杂度，便于前后 eval 对比。
 */

import { logger } from '../logger.js'
import { scoreComplexity } from '../search/complexity.js'

export type RouteStep =
  | 'understand'
  | 'condense'
  | 'rerank'
  | 'compress'
  | 'extract'
  | 'chat'
  | 'tool'

export interface RouteInput {
  step: RouteStep
  /** 用于规则打分的查询文本 */
  query?: string
  /** 外部已计算的复杂度分数（避免重复打分） */
  complexity?: number
  needsPersonalContext?: boolean
  toolIntent?: boolean
  /** 关闭路由时保留调用点原档位 */
  configuredTier?: 'small' | 'large'
}

export interface RouteDecision {
  step: RouteStep
  tier: 'small' | 'large'
  reason: string
  enabled: boolean
  complexity: number
}

export const isRouterEnabled = (): boolean => process.env.LLM_ROUTER !== '0'

const decide = (
  input: RouteInput,
  complexity: number,
): { tier: 'small' | 'large'; reason: string } => {
  switch (input.step) {
    case 'extract':
      return { tier: 'small', reason: 'extract_fixed_small' }
    case 'understand':
    case 'condense':
    case 'rerank':
    case 'compress':
      return { tier: 'small', reason: 'preprocess_fixed_small' }
    case 'tool':
      return { tier: 'large', reason: 'tool_loop_large' }
    case 'chat': {
      if (input.toolIntent) return { tier: 'large', reason: 'tool_intent_large' }
      if (input.needsPersonalContext) return { tier: 'large', reason: 'personal_context_large' }
      if (complexity >= 2) return { tier: 'large', reason: 'complexity_large' }
      return { tier: 'small', reason: 'general_simple_small' }
    }
  }
}

/** 规则路由：纯函数 + 一条决策日志，不产生网络调用。 */
export const routeModel = (input: RouteInput): RouteDecision => {
  const complexity = input.complexity ?? (input.query ? scoreComplexity(input.query).score : 0)

  if (!isRouterEnabled()) {
    return {
      step: input.step,
      tier: input.configuredTier ?? 'small',
      reason: 'router_disabled',
      enabled: false,
      complexity,
    }
  }

  const { tier, reason } = decide(input, complexity)
  const decision: RouteDecision = {
    step: input.step,
    tier,
    reason,
    enabled: true,
    complexity,
  }

  logger.debug('router', 'model route', {
    step: decision.step,
    tier: decision.tier,
    reason: decision.reason,
    complexity,
  })

  return decision
}
