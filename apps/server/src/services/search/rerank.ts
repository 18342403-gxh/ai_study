/**
 * Reranker — spec 1.6
 *
 * 在 merge 之后、assembleContext 之前，对候选做 LLM-based 重排序。
 * 不与 answer 生成合并调用（避免模型为「作答方便」选条目）。
 * 用 Context Relevance 单独度量 rerank 质量。
 */

import { createChatChain } from '../chain/chatChain.js'
import { logger } from '../logger.js'
import type { SearchResultItem } from './merge.js'

const RERANK_TIMEOUT_MS = 8_000
/** rerank 候选上限：避免 LLM prompt 过长 */
const MAX_RERANK_CANDIDATES = 20

/**
 * LLM-based rerank：对每条 (query, candidate) 打 0-1 相关性分，按分重排。
 * 失败时返回原顺序（不阻断检索链路）。
 */
export const rerankCandidates = async (
  query: string,
  candidates: SearchResultItem[],
): Promise<SearchResultItem[]> => {
  if (candidates.length <= 1) return candidates

  const top = candidates.slice(0, MAX_RERANK_CANDIDATES)
  const contextText = top.map((c, i) => `[${i + 1}] ${c.content}`).join('\n---\n')

  const prompt = `你是检索重排序助手。评估以下候选内容与用户问题的相关性，给每条打 0-1 的分数（1=完全相关，0=无关）。
只输出 JSON，格式：{"scores": [{"index": 1, "score": 0.9}, ...]}

问题：${query}

候选：
${contextText}`

  try {
    const chain = createChatChain({ temperature: 0, feature: 'understand' })
    const response = await withTimeout(
      chain.invoke({ messages: [{ role: 'user', content: prompt }] }),
      RERANK_TIMEOUT_MS,
    )
    const text = response.content.trim()
    const parsed = JSON.parse(extractJson(text)) as {
      scores: Array<{ index: number; score: number }>
    }
    if (!parsed.scores || !Array.isArray(parsed.scores)) return candidates

    const scoreMap = new Map<number, number>()
    for (const s of parsed.scores) {
      if (typeof s.index === 'number' && typeof s.score === 'number') {
        scoreMap.set(s.index, s.score)
      }
    }

    const scored = top.map((c, i) => ({
      item: c,
      rerankScore: scoreMap.get(i + 1) ?? c.channelScore * 0.5,
    }))
    scored.sort((a, b) => b.rerankScore - a.rerankScore)

    logger.debug('rerank', '重排序完成', {
      candidateCount: top.length,
      topScore: scored[0]?.rerankScore,
    })

    // 把 rerankScore 合并到 item.score（加权：0.7 * rerank + 0.3 * original）
    return scored.map(({ item, rerankScore }) => ({
      ...item,
      score: 0.7 * rerankScore + 0.3 * item.score,
    }))
  } catch (err) {
    logger.warn('rerank', 'rerank 失败，保持原顺序', {
      error: (err as Error).message.slice(0, 100),
    })
    return candidates
  }
}

/** 从 LLM 输出中提取 JSON 对象 */
const extractJson = (text: string): string => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rerank timeout')), ms)
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
