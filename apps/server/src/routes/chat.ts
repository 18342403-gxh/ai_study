/**
 * AI 聊天代理 API — LangChain 架构版
 * POST /api/chat/completions — 基于 LangChain Runnable 抽象
 */

import { Router } from 'express'
import { createChatChain } from '../services/chain/chatChain.js'

const router = Router()

/** POST /api/chat/completions */
router.post('/completions', async (req, res) => {
  try {
    const { messages, model, stream, temperature } = req.body

    const chain = createChatChain({ model, temperature })

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      for await (const delta of chain.stream({ messages, stream: true })) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
      }

      res.write('data: [DONE]\n\n')
      res.end()
    } else {
      const result = await chain.invoke({ messages })
      res.json({
        choices: [
          {
            message: { role: 'assistant', content: result.content },
            finish_reason: 'stop',
          },
        ],
        usage: result.usage,
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '请求失败'
    const statusCode = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 500
    if (!res.headersSent) {
      res.status(statusCode).json({ error: message })
    } else {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
      res.end()
    }
  }
})

export default router
