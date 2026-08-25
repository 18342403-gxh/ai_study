/**
 * 知识库问答 API
 * POST /api/kb/query — 基于知识库的检索+生成（RAG 雏形）
 *
 * 架构：kb 路由 → embedding 服务（检索） → chatChain（生成）
 * 统一通过 chatChain 调用 LLM，不再直接 fetch API
 */

import { Router } from 'express'
import { z } from 'zod'

import { getDb } from '../db/index.js'
import { getEmbedding, cosineSimilarity } from '../services/embedding.js'
import { createChatChain } from '../services/chain/chatChain.js'
import { validate, asyncHandler, createError } from '../middleware/index.js'

const router = Router()
const TOP_K = 5

const querySchema = z.object({
  query: z.string().trim().min(1, '请输入问题'),
  documentIds: z.array(z.string()).optional(),
  stream: z.boolean().default(true),
})

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

/**
 * RAG 检索：向量相似度搜索 Top-K
 */
async function retrieveTopChunks(query: string, documentIds?: string[]) {
  const db = getDb()
  const queryEmbedding = await getEmbedding(query)

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

  const scored = chunks.map((chunk) => {
    const embedding = JSON.parse(chunk.embedding) as number[]
    const score = cosineSimilarity(queryEmbedding, embedding)
    return { ...chunk, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, TOP_K)
}

/**
 * 构造带引用的系统 Prompt
 */
function buildRagSystemPrompt(topChunks: Array<{ content: string; score: number }>) {
  const contextText = topChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n')
  return `你是一个知识库问答助手。请根据以下参考文档来回答用户的问题。
如果参考文档中包含答案，请基于文档内容回答，并在相关内容后标注引用编号如[1][2]。
如果文档中没有相关信息，请诚实告知用户。

参考文档：
${contextText}`
}

/** POST /api/kb/query */
router.post(
  '/query',
  validate({ body: querySchema }),
  asyncHandler(async (req, res) => {
    const { query, documentIds, stream } = req.body

    const topChunks = await retrieveTopChunks(query, documentIds)
    const systemPrompt = buildRagSystemPrompt(topChunks)

    const db = getDb()
    const citations = topChunks.map((c, i) => {
      const doc = db.prepare('SELECT name FROM documents WHERE id = ?').get(c.doc_id) as DocumentRow | undefined
      return {
        index: i + 1,
        content: c.content.slice(0, 200),
        source: doc?.name || '未知文档',
        score: Math.round((c as unknown as { score: number }).score * 100) / 100,
      }
    })

    const chain = createChatChain({ temperature: 0.3 })

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const controller = new AbortController()
      req.on('close', () => controller.abort())

      res.write(`data: ${JSON.stringify({ type: 'citations', citations })}\n\n`)

      try {
        for await (const delta of chain.stream(
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: query },
            ],
            stream: true,
          },
          { signal: controller.signal }
        )) {
          res.write(
            `data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`
          )
        }
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      } catch (err) {
        if (!res.headersSent) throw err
        res.write(
          `data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`
        )
      }

      res.end()
    } else {
      const result = await chain.invoke({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
      })

      res.json({
        answer: result.content,
        citations,
      })
    }
  })
)

export default router
