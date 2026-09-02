/**
 * AI 聊天代理 API — LangChain 架构版
 * POST /api/chat/completions — 基于 LangChain Runnable 抽象
 */

import { Router } from 'express'
import { z } from 'zod'
import { createChatChain } from '../services/chain/chatChain.js'
import { validate, asyncHandler } from '../middleware/index.js'

const router = Router()

// ── Zod 校验 Schema ─────────────────────────────────
const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().min(1, '消息内容不能为空').max(20_000, '消息过长（最多 20000 字符）'),
  name: z.string().optional(),
})

const chatCompletionsSchema = z.object({
  messages: z.array(messageSchema).min(1, '至少一条消息').max(50, '最多 50 条消息'),
  model: z.string().min(1).max(64).optional(),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional().default(0.7),
})

// ── 路由 ─────────────────────────────────────────────

/** POST /api/chat/completions */
router.post(
  '/completions',
  validate({ body: chatCompletionsSchema }),
  asyncHandler(async (req, res) => {
    const { messages, model, stream, temperature } = req.body as z.infer<typeof chatCompletionsSchema>

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
  })
)

export default router
