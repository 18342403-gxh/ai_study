/**
 * 知识库问答 API
 * POST /api/kb/query — 基于知识库的检索+生成（RAG 雏形）
 *
 * 架构：kb 路由 → embedding 服务（检索） → chatChain（生成）
 * 统一通过 chatChain 调用 LLM，不再直接 fetch API
 */

import { Router } from 'express'
import { z } from 'zod'
import { eq } from 'drizzle-orm'

import { getDb, tables } from '../db/index.js'
import { createChatChain } from '../services/chain/chatChain.js'
import { searchAll } from '../services/search/searchAll.js'
import { logger } from '../services/logger.js'
import { validate, asyncHandler } from '../middleware/index.js'

const router = Router()
const TOP_K = 5

const querySchema = z.object({
  query: z.string().trim().min(1, '请输入问题'),
  documentIds: z.array(z.string()).optional(),
  stream: z.boolean().default(true),
})

/**
 * RAG 检索：统一走 searchAll 三通道编排（与 /api/chat 共享同一套检索路径）
 * 仅取文档块（chunk）结果，documentIds 在后处理阶段过滤
 */
async function retrieveTopChunks(query: string, documentIds?: string[]) {
  const outcome = await searchAll({ query })
  let chunks = outcome.results.filter((r) => r.kind === 'chunk')
  if (documentIds && documentIds.length > 0) {
    chunks = chunks.filter((r) => r.docId && documentIds.includes(r.docId))
  }
  return chunks.slice(0, TOP_K)
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
    logger.info('kb.route', 'POST /query — 入口', { stream, hasDocIds: !!documentIds })

    const topChunks = await retrieveTopChunks(query, documentIds)
    const systemPrompt = buildRagSystemPrompt(topChunks)

    const db = getDb()
    const citations = await Promise.all(
      topChunks.map(async (c, i) => {
        let source = '未知文档'
        if (c.docId) {
          const docs = await db
            .select({ name: tables.documents.name })
            .from(tables.documents)
            .where(eq(tables.documents.id, c.docId))
            .limit(1)
          source = docs[0]?.name || '未知文档'
        }
        return {
          index: i + 1,
          content: c.content.slice(0, 200),
          source,
          score: Math.round(c.score * 100) / 100,
        }
      }),
    )

    const chain = createChatChain({ temperature: 0.3, feature: 'chat_general' })

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
          { signal: controller.signal },
        )) {
          res.write(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`)
        }
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
      } catch (err) {
        if (!res.headersSent) throw err
        res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`)
      }

      logger.info('kb.route', 'POST /query — 出口 (stream)', { topChunkCount: topChunks.length })
      res.end()
    } else {
      const result = await chain.invoke({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
      })

      logger.info('kb.route', 'POST /query — 出口 (invoke)', { topChunkCount: topChunks.length })
      res.json({
        answer: result.content,
        citations,
      })
    }
  }),
)

export default router
