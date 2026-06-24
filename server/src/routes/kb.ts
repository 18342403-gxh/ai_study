/**
 * 知识库问答 API
 * POST /api/kb/query — 基于知识库的问答（检索 + 生成）
 */

import { Router } from 'express'

import { getDb } from '../db/index.js'
import { getEmbedding, cosineSimilarity } from '../services/embedding.js'

const router = Router()

const API_URL = process.env.AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4'
const API_KEY = process.env.AI_API_KEY || ''
const MODEL = process.env.AI_MODEL || 'glm-4-flash'
const TOP_K = 5  // 检索最相关的 5 个块

interface ChunkRow {
  id: string
  doc_id: string
  content: string
  chunk_index: number
  embedding: string
}

interface DocumentRow {
  id: string
  name: string
}

/** POST /api/kb/query */
router.post('/query', async (req, res) => {
  try {
    const { query, documentIds } = req.body as { query: string; documentIds?: string[] }

    if (!query?.trim()) {
      res.status(400).json({ error: '请输入问题' })
      return
    }

    const db = getDb()

    // 1. 将用户问题转为向量
    const queryEmbedding = await getEmbedding(query)

    // 2. 从数据库获取所有相关文档的块
    let chunks: ChunkRow[]
    if (documentIds && documentIds.length > 0) {
      const placeholders = documentIds.map(() => '?').join(',')
      chunks = db.prepare(
        `SELECT * FROM chunks WHERE doc_id IN (${placeholders}) AND embedding IS NOT NULL`
      ).all(...documentIds) as ChunkRow[]
    } else {
      chunks = db.prepare(
        'SELECT * FROM chunks WHERE embedding IS NOT NULL'
      ).all() as ChunkRow[]
    }

    // 3. 计算每个块和问题向量的相似度
    const scored = chunks.map((chunk) => {
      const embedding = JSON.parse(chunk.embedding) as number[]
      const score = cosineSimilarity(queryEmbedding, embedding)
      return { ...chunk, score }
    })

    // 4. 排序取 Top-K
    scored.sort((a, b) => b.score - a.score)
    const topChunks = scored.slice(0, TOP_K)

    // 5. 构造带知识上下文的 Prompt
    const contextText = topChunks
      .map((c, i) => `[${i + 1}] ${c.content}`)
      .join('\n\n')

    const systemPrompt = `你是一个知识库问答助手。请根据以下参考文档来回答用户的问题。
如果参考文档中包含答案，请基于文档内容回答，并在相关内容后标注引用编号如[1][2]。
如果文档中没有相关信息，请诚实告知用户。

参考文档：
${contextText}`

    // 6. 调用 AI 生成回答（流式）
    const aiResponse = await fetch(`${API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        stream: true,
      }),
    })

    if (!aiResponse.ok) {
      const errText = await aiResponse.text()
      res.status(500).json({ error: `AI 请求失败: ${errText}` })
      return
    }

    // 7. 返回流式响应 + 引用信息
    // 先发引用元数据
    const citations = topChunks.map((c, i) => {
      // 查找文档名
      const doc = db.prepare('SELECT name FROM documents WHERE id = ?').get(c.doc_id) as DocumentRow | undefined
      return {
        index: i + 1,
        content: c.content.slice(0, 200),
        source: doc?.name || '未知文档',
        score: Math.round(c.score * 100) / 100,
      }
    })

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    // 先发送引用数据
    res.write(`data: ${JSON.stringify({ type: 'citations', citations })}\n\n`)

    // 透传 AI 的流式响应
    const reader = aiResponse.body?.getReader()
    if (!reader) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: '无法获取 AI 响应流' })}\n\n`)
      res.end()
      return
    }

    const decoder = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      // 直接透传 SSE 数据
      res.write(text)
    }

    res.end()
  } catch (err) {
    const message = err instanceof Error ? err.message : '问答失败'
    if (!res.headersSent) {
      res.status(500).json({ error: message })
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
      res.end()
    }
  }
})

export default router
