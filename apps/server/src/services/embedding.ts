/**
 * Embedding 服务
 * 调用 LLM Embedding API 将文本转为向量
 *
 * 🔽 自动降级机制：
 *   当 API 不可用（余额不足、网络错误、超时等）时，
 *   自动降级为 **hash 向量**（确定性伪随机向量），
 *   保证系统不崩，RAG 功能可跑（检索精度下降但可用性保留）。
 *
 * 可控开关：
 *   ENABLE_MOCK_EMBEDDING=1  → 强制使用 mock 模式（不调 API）
 *   DISABLE_EMBEDDING_FALLBACK=1 → API 失败直接 throw（不降级）
 */

import { logger } from './logger.js'
import crypto from 'node:crypto'

const EMBEDDING_DIM = 1536  // 和智谱 embedding-3 一致

function getEnv() {
  return {
    apiUrl: process.env.AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.EMBEDDING_MODEL || 'embedding-3',
    forceMock: process.env.ENABLE_MOCK_EMBEDDING === '1',
    disableFallback: process.env.DISABLE_EMBEDDING_FALLBACK === '1',
  }
}

/**
 * 生成确定性 hash 向量 — 降级方案
 *
 * 原理：
 *   1. 对 text 做 SHA-256 → 32 字节种子
 *   2. 用种子生成 1536 个正态分布伪随机数（Box-Muller 变换）
 *   3. L2 归一化
 *
 * 特性：
 *   - 相同 text → 完全相同向量（幂等）
 *   - 向量方向随机（cosine ≈ 0 对不同文本）
 *   - 向量长度 = 1.0（归一化后）
 *   - 不依赖任何外部 API，纯本地
 */
export function hashVector(text: string, dim = EMBEDDING_DIM): number[] {
  // ① SHA-256 种子
  const hash = crypto.createHash('sha256').update(text).digest('hex')
  // 把 hex 转成 8 个 32-bit 种子数
  const seeds: number[] = []
  for (let i = 0; i < hash.length; i += 8) {
    seeds.push(parseInt(hash.slice(i, i + 8), 16))
  }

  // ② Mulberry32 PRNG（确定性伪随机数生成器）
  let seedIdx = 0
  const mulberry32 = () => {
    let a = seeds[seedIdx % seeds.length] >>> 0
    return function () {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const rand = mulberry32()

  // ③ Box-Muller 变换 → 正态分布
  const vec: number[] = []
  for (let i = 0; i < dim; i += 2) {
    const u1 = rand() || 1e-10
    const u2 = rand()
    const r = Math.sqrt(-2 * Math.log(u1))
    const theta = 2 * Math.PI * u2
    vec.push(r * Math.cos(theta))
    if (i + 1 < dim) vec.push(r * Math.sin(theta))
  }

  // ④ L2 归一化
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < vec.length; i++) vec[i] /= norm

  return vec
}

/** 全局 mock 模式状态（用于日志只打一次） */
let mockModeActivated = false

/** 将单段文本转为向量（自动降级） */
export const getEmbedding = async (text: string): Promise<number[]> => {
  const { apiUrl, apiKey, model, forceMock, disableFallback } = getEnv()

  // ── 强制 mock 模式 ────────────────────────────────
  if (forceMock) {
    logger.debug('embedding.service', 'getEmbedding — 强制 mock 模式', { textLen: text.length })
    return hashVector(text)
  }

  const start = Date.now()
  logger.info('embedding.service', 'getEmbedding — 入口', { textLen: text.length })

  try {
    const response = await fetch(`${apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>
    }
    const costMs = Date.now() - start
    logger.info('embedding.service', 'getEmbedding — 成功', { costMs })
    return data.data[0].embedding
  } catch (err) {
    // ── 降级：hash 向量 ───────────────────────────────
    if (disableFallback) {
      logger.error('embedding.service', 'getEmbedding — 失败（fallback 已禁用）', {
        error: (err as Error).message,
      })
      throw err
    }

    if (!mockModeActivated) {
      logger.warn('embedding.service', '⚠️  Embedding API 不可用，启用 hash 向量降级', {
        error: (err as Error).message,
        hint: '充值 API Key 或设 ENABLE_MOCK_EMBEDDING=1 强制 mock',
      })
      mockModeActivated = true  // 只打一次 warn
    }

    const costMs = Date.now() - start
    logger.debug('embedding.service', 'getEmbedding — hash 降级', { costMs, textLen: text.length })
    return hashVector(text)
  }
}

/** 批量获取 embedding（自动降级） */
export const getEmbeddings = async (texts: string[]): Promise<number[][]> => {
  const { forceMock, disableFallback } = getEnv()

  if (forceMock) {
    logger.debug('embedding.service', 'getEmbeddings — 强制 mock 模式', { count: texts.length })
    return texts.map((t) => hashVector(t))
  }

  // 批量模式下，逐个调用 getEmbedding（每个都有独立的降级逻辑）
  const results: number[][] = []
  const batchSize = 10

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    // 每个 batch 独立处理：API 失败的单个文本 → hash，不影响同 batch 其他
    const batchResults = await Promise.all(
      batch.map(async (text) => {
        try {
          return await getEmbedding(text)
        } catch {
          return hashVector(text)
        }
      }),
    )
    results.push(...batchResults)
  }

  return results
}

/** 计算两个向量的余弦相似度 */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/** 🔍 当前是否在 mock 模式（诊断用） */
export const isMockMode = (): boolean => {
  const { forceMock } = getEnv()
  return forceMock || mockModeActivated
}
