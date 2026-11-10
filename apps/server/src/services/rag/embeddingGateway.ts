/**
 * Embedding 服务 — 实现层（内部）
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
 *
 * ⚠️ 内部文件，外部请通过 rag/embeddings.ts 或 rag/index.ts 访问。
 */

import { logger } from '../logger.js'
import { costTracker } from '../costTracker.js'
import crypto from 'node:crypto'

const EMBEDDING_DIM = 1536 // 和智谱 embedding-3 一致

/** 单次 embedding 请求超时：超时走 catch → hash 降级，避免挂死检索链路 */
const EMBEDDING_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.EMBEDDING_TIMEOUT_MS || '15000', 10) || 15_000,
)

/**
 * mock 模式 TTL（毫秒）。
 * 当 Embedding API 失败时，进入 mock 模式但只持续 MOCK_TTL_MS，
 * 过期后下次调用会主动探测一次真实 API，成功则清除 mock 标记（自愈）。
 * 默认 5 分钟，可通过 EMBEDDING_MOCK_TTL_MS 调整。
 */
const MOCK_TTL_MS = Math.max(
  5_000,
  parseInt(process.env.EMBEDDING_MOCK_TTL_MS || '300000', 10) || 300_000,
)

/** 探测用的短文本（embedding-3 要求 input 非空且有最小长度） */
const PROBE_TEXT = 'probe'

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
  const seedIdx = 0
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

/**
 * mock 模式过期时间戳（ms）。
 * 0 = 不在 mock 模式；> 0 且 Date.now() < mockUntil = 处于 mock 模式（TTL 内）。
 * 过期后下次 getEmbedding 会主动探测一次真实 API，成功则清零（自愈）。
 */
let mockUntil = 0

/** 是否正在探测真实 API（避免并发重复探测） */
let probing = false

/**
 * 主动探测真实 Embedding API 是否恢复。
 * 成功 → 清除 mockUntil（自愈）；失败 → 续期 TTL。
 * 探测本身不计入成本追踪（避免 mock 期间产生无意义记账）。
 */
async function probeRealEmbedding(): Promise<boolean> {
  const { apiUrl, apiKey, model } = getEnv()
  try {
    const response = await fetch(`${apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: PROBE_TEXT }),
      signal: AbortSignal.timeout(Math.min(EMBEDDING_TIMEOUT_MS, 5_000)),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    // 成功：清除 mock 标记
    mockUntil = 0
    logger.warn('embedding.service', '✅ Embedding API 已恢复，退出 hash 降级')
    return true
  } catch (err) {
    // 失败：续期 TTL
    mockUntil = Date.now() + MOCK_TTL_MS
    logger.warn('embedding.service', '🔄 Embedding API 仍不可用，续期 mock TTL', {
      error: (err as Error).message.slice(0, 100),
      ttlMs: MOCK_TTL_MS,
    })
    return false
  }
}

/** 将单段文本转为向量（自动降级 + TTL 自愈） */
export const getEmbedding = async (text: string): Promise<number[]> => {
  const { apiUrl, apiKey, model, forceMock, disableFallback } = getEnv()

  // ── 强制 mock 模式 ────────────────────────────────
  if (forceMock) {
    logger.debug('embedding.service', 'getEmbedding — 强制 mock 模式', { textLen: text.length })
    costTracker.track({
      feature: 'embedding',
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costMs: 0,
      metadata: { mock: true, forceMock: true },
    })
    return hashVector(text)
  }

  // ── TTL 过期 → 主动探测真实 API（自愈）─────────────
  if (mockUntil > 0 && Date.now() >= mockUntil && !probing) {
    probing = true
    // 不 await 探测结果对调用方透明：探测失败续期 TTL，本次仍走 mock；
    // 探测成功则清零，后续调用走真实 API。
    void probeRealEmbedding().finally(() => {
      probing = false
    })
  }

  // ── mock TTL 内 → 直接返回 hash 向量（跳过网络调用）──
  if (mockUntil > 0 && Date.now() < mockUntil) {
    costTracker.track({
      feature: 'embedding',
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costMs: 0,
      metadata: { mock: true, ttlRemainingMs: mockUntil - Date.now() },
    })
    return hashVector(text)
  }

  const start = Date.now()
  logger.info('embedding.service', 'getEmbedding — 入口', { textLen: text.length })

  try {
    const response = await fetch(`${apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>
      usage?: { prompt_tokens?: number; total_tokens?: number }
    }
    const costMs = Date.now() - start
    logger.info('embedding.service', 'getEmbedding — 成功', { costMs })

    // ── 成功：清除 mock 标记（自愈）──────────────────
    if (mockUntil !== 0) {
      mockUntil = 0
      logger.warn('embedding.service', '✅ Embedding API 已恢复，退出 hash 降级')
    }

    // ── 成本追踪 ──────────────────────────────────
    if (data.usage) {
      costTracker.track({
        feature: 'embedding',
        model,
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: 0, // Embedding 没有 completion
        totalTokens: data.usage.total_tokens ?? 0,
        costMs,
      })
    }

    return data.data[0].embedding
  } catch (err) {
    // ── 降级：hash 向量 + 启动 TTL ──────────────────
    if (disableFallback) {
      logger.error('embedding.service', 'getEmbedding — 失败（fallback 已禁用）', {
        error: (err as Error).message,
      })
      throw err
    }

    // 进入 mock 模式并设置 TTL（5 分钟后自动探测恢复）
    mockUntil = Date.now() + MOCK_TTL_MS
    logger.warn('embedding.service', '⚠️  Embedding API 不可用，启用 hash 向量降级（TTL 自愈）', {
      error: (err as Error).message,
      hint: 'TTL 到期后自动探测恢复，无需重启进程',
      ttlMs: MOCK_TTL_MS,
    })

    const costMs = Date.now() - start
    logger.debug('embedding.service', 'getEmbedding — hash 降级', { costMs, textLen: text.length })

    costTracker.track({
      feature: 'embedding',
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costMs,
      metadata: { mock: true, reason: (err as Error).message.slice(0, 100) },
    })

    return hashVector(text)
  }
}

/** 批量获取 embedding（自动降级，worker pool 限并发） */
export const getEmbeddings = async (texts: string[]): Promise<number[][]> => {
  const { forceMock } = getEnv()

  if (forceMock) {
    logger.debug('embedding.service', 'getEmbeddings — 强制 mock 模式', { count: texts.length })
    return texts.map((t) => hashVector(t))
  }

  // 并发 4（spec 阶段 11）：免费档限速敏感，批量上传文档时避免打满厂商 QPS
  const concurrency = Math.max(1, parseInt(process.env.EMBEDDING_CONCURRENCY || '4', 10) || 4)
  const results: number[][] = new Array(texts.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < texts.length) {
      const i = next++
      // 单个文本失败 → hash 降级，不影响其他文本
      try {
        results[i] = await getEmbedding(texts[i])
      } catch {
        results[i] = hashVector(texts[i])
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, () => worker()))
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
  return forceMock || (mockUntil > 0 && Date.now() < mockUntil)
}

/** embedding mock 状态详情（供 /api/cost 查询展示） */
export const getEmbeddingMockState = (): {
  active: boolean
  forceMock: boolean
  mockUntil: number
  ttlRemainingMs: number
  ttlMs: number
} => {
  const { forceMock } = getEnv()
  const active = forceMock || (mockUntil > 0 && Date.now() < mockUntil)
  return {
    active,
    forceMock,
    mockUntil,
    ttlRemainingMs: mockUntil > 0 ? Math.max(0, mockUntil - Date.now()) : 0,
    ttlMs: MOCK_TTL_MS,
  }
}
