/**
 * 规则版查询复杂度评分（P0 · R1 前置）
 *
 * 不调用模型，只用可解释的启发式信号打分，作为路由/递归检索的门控依据。
 * 分数含义：0 = 简单，≥2 = 复杂（触发大模型或更深检索）。
 */

export interface ComplexitySignals {
  /** 多意图：并列/递进连词或多个问句 */
  multiIntent: boolean
  /** 含时间表达 */
  temporal: boolean
  /** 实体数量（书名号 / 引号 / 顿号分隔项） */
  entityCount: number
  /** 查询长度（字符） */
  length: number
}

export interface ComplexityScore {
  score: number
  signals: ComplexitySignals
}

const MULTI_INTENT_RE = /(?:并且|同时|以及|另外|而且|顺便|分别|还要|再帮我|顺便问)/
const TEMPORAL_RE =
  /(?:今天|明天|昨天|前天|后天|本周|这周|上周|下周|本月|这个月|上个月|下个月|今年|去年|明年|最近|近期|周末|\d{4}\s*年|\d{1,2}\s*月|\d{1,2}\s*[日号])/

const countEntities = (query: string): number => {
  const bracketed = query.match(/《[^》]+》/g)?.length ?? 0
  const quoted = query.match(/[「“"][^”"」]{1,30}[”"」]/g)?.length ?? 0
  const listed = query.includes('、')
    ? query.split('、').filter((p) => p.trim().length > 0).length
    : 0
  return bracketed + quoted + Math.max(0, listed - 1)
}

export const scoreComplexity = (query: string): ComplexityScore => {
  const trimmed = query.trim()
  const signals: ComplexitySignals = {
    multiIntent: MULTI_INTENT_RE.test(trimmed) || (trimmed.match(/[？?]/g)?.length ?? 0) >= 2,
    temporal: TEMPORAL_RE.test(trimmed),
    entityCount: countEntities(trimmed),
    length: trimmed.length,
  }

  let score = 0
  if (signals.multiIntent) score += 1
  if (signals.temporal) score += 1
  if (signals.entityCount >= 2) score += 1
  if (signals.length >= 30) score += 1

  return { score, signals }
}
