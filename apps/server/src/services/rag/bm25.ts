/**
 * BM25 关键词检索 — 纯 TS 实现，零依赖
 *
 * BM25 是传统 IR（信息检索）的经典算法，擅长精确关键词匹配。
 * 当用户 query 包含确切词汇（如 "Pinia store", "defineStore", "useRouter"）时，
 * BM25 比 cosine similarity 更准。
 *
 * 算法：
 *   score = Σ( IDF(qi) * (tf(qi, d) * (k1+1)) / (tf(qi, d) + k1 * (1 - b + b * dl/avgdl)) )
 *
 *   IDF(qi) = ln((N - df(qi) + 0.5) / (df(qi) + 0.5) + 1)
 *
 *   k1 = 1.2   (term frequency saturation)
 *   b  = 0.75  (document length normalization)
 *
 *   中文：按标点/空白分词
 *   英文：按非字母数字字符分词 + lowercase
 */

import { getDb } from '../../db/index.js'

const K1 = 1.2
const B = 0.75

export interface BM25Result {
  id: string
  doc_id: string
  content: string
  chunk_index: number
  score: number
}

/** 简单分词器：中英混合场景 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []

  // 先按非字母数字字符切成候选
  const segments = text.toLowerCase().split(/[\s,.;:!?()[\]{}<>'"\\/|@#$%^&*+=`~\-_—…·]+/)

  for (const seg of segments) {
    if (!seg.trim()) continue

    // 纯 ASCII 单词 → 加整词
    if (/^[\x00-\x7f]+$/.test(seg)) {
      if (seg.length > 1) tokens.push(seg)
      continue
    }

    // 中文/混合场景 → 2-gram 滑动窗口
    // "我喜欢写Vue组件" → ["我喜", "喜欢", "欢写", ..., "Vue", "ue组", "组件"]
    // 先抽出英文单词，剩余中文做 2-gram
    const enWords = seg.match(/[a-z0-9]+/g) || []
    const zhPart = seg.replace(/[a-z0-9]+/g, '').trim()

    for (const w of enWords) if (w.length > 1) tokens.push(w)

    if (zhPart.length >= 2) {
      for (let i = 0; i <= zhPart.length - 2; i++) {
        tokens.push(zhPart.slice(i, i + 2))
      }
    } else if (zhPart.length === 1) {
      tokens.push(zhPart)
    }
  }

  return tokens
}

/** 从 SQLite 读全部 chunks → 算 BM25 → 排序取 Top-K */
export async function bm25Search(query: string, k = 5, docId?: string): Promise<BM25Result[]> {
  const db = getDb()

  let rows: Array<{
    id: string
    doc_id: string
    content: string
    chunk_index: number
  }>

  if (docId) {
    rows = (await db
      .prepare(
        'SELECT id, doc_id, content, chunk_index FROM chunks WHERE doc_id = ? AND content IS NOT NULL',
      )
      .all(docId)) as typeof rows
  } else {
    rows = (await db
      .prepare('SELECT id, doc_id, content, chunk_index FROM chunks WHERE content IS NOT NULL')
      .all()) as typeof rows
  }

  if (rows.length === 0) return []

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  const N = rows.length
  const docTokens: string[][] = rows.map((r) => tokenize(r.content))
  const docLens = docTokens.map((t) => t.length)
  const avgdl = docLens.reduce((a, b) => a + b, 0) / N

  // 1. 计算每个 chunk 的 tf
  const tfList: Array<Record<string, number>> = docTokens.map((tokens) => {
    const tf: Record<string, number> = {}
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1
    return tf
  })

  // 2. 计算每个 query token 的 df（跨 chunks）
  const df: Record<string, number> = {}
  for (const qt of queryTokens) {
    if (df[qt] !== undefined) continue
    let cnt = 0
    for (const tokens of docTokens) {
      if (tokens.includes(qt)) cnt++
    }
    df[qt] = cnt
  }

  // 3. 计算 BM25 score
  const scores: number[] = new Array(N).fill(0)
  for (let i = 0; i < N; i++) {
    const tf = tfList[i]
    const dl = docLens[i]
    let score = 0

    for (const qt of queryTokens) {
      const tfVal = tf[qt] || 0
      if (tfVal === 0) continue
      const dfVal = df[qt]
      const idf = Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1)
      const denom = tfVal + K1 * (1 - B + B * (dl / avgdl))
      score += (idf * (tfVal * (K1 + 1))) / denom
    }

    scores[i] = score
  }

  // 4. 排序 + 返回 Top-K
  const indexed = scores.map((s, i) => ({ score: s, idx: i }))
  indexed.sort((a, b) => b.score - a.score)

  return indexed.slice(0, k).map(({ score, idx }) => ({
    id: rows[idx].id,
    doc_id: rows[idx].doc_id,
    content: rows[idx].content,
    chunk_index: rows[idx].chunk_index,
    score,
  }))
}
