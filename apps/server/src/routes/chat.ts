/**
 * AI 聊天代理 API
 * POST /api/chat/completions — 代理转发 AI 请求（隐藏 API Key）
 *
 * 前端不再直接持有 API Key，所有请求经由此接口转发
 */

import { Router } from 'express'

const router = Router()

const API_URL = process.env.AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4'
const API_KEY = process.env.AI_API_KEY || ''

/** POST /api/chat/completions — 透传请求到 AI API */
router.post('/completions', async (req, res) => {
  try {
    const { messages, model, stream, tools, temperature } = req.body

    const aiResponse = await fetch(`${API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: model || process.env.AI_MODEL || 'glm-4-flash',
        messages,
        stream: stream ?? false,
        ...(tools ? { tools } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      }),
    })

    if (!aiResponse.ok) {
      const errText = await aiResponse.text()
      res.status(aiResponse.status).json({ error: errText })
      return
    }

    if (stream) {
      // 流式响应：设置 SSE 头并透传
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const reader = aiResponse.body?.getReader()
      if (!reader) {
        res.status(500).json({ error: '无法获取响应流' })
        return
      }

      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        res.write(decoder.decode(value, { stream: true }))
      }
      res.end()
    } else {
      // 非流式响应：直接返回 JSON
      const data = await aiResponse.json()
      res.json(data)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '请求失败'
    res.status(500).json({ error: message })
  }
})

export default router
