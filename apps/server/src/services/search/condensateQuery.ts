/**
 * Query Condensation — 多轮对话查询凝练（spec 1.7）
 *
 * 在检索前把带指代、带省略的追问还原成能独立成立的完整问题。
 * 例如：上一轮问"下周有什么安排"，这轮问"那周五呢" → 改写为"下周五有什么安排"。
 *
 * 设计原则：
 *   - 话题连续性门控：先用 embedding 余弦相似度判断是追问还是新话题，避免历史污染新话题
 *   - 改写后 query 用于检索，原问题保留用于生成答案
 *   - 改写失败/置信度低时回退原 query
 */

import { createChatChain } from '../chain/chatChain.js'
import { getEmbedding, cosineSimilarity } from '../rag/index.js'
import { logger } from '../logger.js'

/** 话题门控阈值：> high 视为追问，< low 视为新话题，中间调 LLM 精细分类 */
const TOPIC_SIMILARITY_HIGH = 0.8
const TOPIC_SIMILARITY_LOW = 0.3
/** 改写超时（避免阻塞检索链路） */
const REWRITE_TIMEOUT_MS = 5_000
/** 改写失败时返回原 query */
const FALLBACK = (q: string) => q

interface CondensateParams {
  query: string
  history: Array<{ role: string; content: string }>
  enableTopicGate?: boolean
}

interface CondensateResult {
  /** 用于检索的 query（可能是改写后的） */
  condensed: string
  /** 是否做了改写 */
  rewritten: boolean
  /** 话题门控判定结果 */
  topic: 'follow_up' | 'new_topic' | 'uncertain'
}

/**
 * 查询凝练主入口。
 * - 新话题或无历史：直接返回原 query
 * - 追问：用 LLM 改写为独立问题
 */
export const condensateQuery = async (params: CondensateParams): Promise<CondensateResult> => {
  const { query, history, enableTopicGate = true } = params

  // 无历史 → 无需改写
  if (!history || history.length === 0) {
    return { condensed: query, rewritten: false, topic: 'new_topic' }
  }

  // 取最近 2-3 轮 user/assistant 消息
  const recent = history.slice(-6)
  const lastUserMsg = [...recent].reverse().find((m) => m.role === 'user')
  if (!lastUserMsg) {
    return { condensed: query, rewritten: false, topic: 'new_topic' }
  }

  // ── 话题连续性门控 ──────────────────────────────
  let topic: 'follow_up' | 'new_topic' | 'uncertain' = 'uncertain'
  if (enableTopicGate) {
    try {
      const [qEmb, lastEmb] = await Promise.all([
        getEmbedding(query),
        getEmbedding(lastUserMsg.content),
      ])
      const sim = cosineSimilarity(qEmb, lastEmb)
      if (sim > TOPIC_SIMILARITY_HIGH) topic = 'follow_up'
      else if (sim < TOPIC_SIMILARITY_LOW) topic = 'new_topic'
    } catch {
      // embedding 失败不阻断，默认走 LLM 精细分类
      topic = 'uncertain'
    }
  }

  // 新话题 → 跳过改写，直接用原 query（避免历史上下文污染）
  if (topic === 'new_topic') {
    return { condensed: query, rewritten: false, topic }
  }

  // ── LLM 改写 ──────────────────────────────────
  try {
    const contextText = recent
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
      .join('\n')

    const chain = createChatChain({ temperature: 0, feature: 'understand' })
    const prompt = `你是查询改写助手。根据对话历史，把用户当前问题改写为一个能独立成立的完整问题（补全省略的主语、时间等指代）。
如果当前问题本身已经完整，不需要改写，直接返回原问题。
只输出改写后的问题，不要解释，不要加引号。

对话历史：
${contextText}

当前问题：${query}

改写后的问题：`

    const rewritten = await withTimeout(
      chain.invoke({ messages: [{ role: 'user', content: prompt }] }),
      REWRITE_TIMEOUT_MS,
    )
    const text = rewritten.content.trim()
    if (!text) return { condensed: query, rewritten: false, topic }

    logger.debug('condensate', '查询改写完成', {
      original: query.slice(0, 80),
      condensed: text.slice(0, 80),
      topic,
    })
    return { condensed: text, rewritten: true, topic }
  } catch (err) {
    logger.warn('condensate', '查询改写失败，回退原 query', {
      error: (err as Error).message.slice(0, 100),
    })
    return { condensed: FALLBACK(query), rewritten: false, topic }
  }
}

/** 带超时的 Promise 包装 */
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('condensate timeout')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
