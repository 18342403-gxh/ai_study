/**
 * AI 聊天 API
 * POST /api/chat             — 个人知识问答（v5 阶段 7：检索 + 强制引用 + citations 快照）
 * POST /api/chat/completions — 基于 LangChain Runnable 抽象的通用代理
 */

import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { and, desc, eq } from 'drizzle-orm'

import { getDb, tables } from '../db/index.js'
import { createChatChain } from '../services/chain/chatChain.js'
import { routeModel } from '../services/chain/router.js'
import type { ChatMessage } from '../services/chain/model.js'
import { logger } from '../services/logger.js'
import { generateAnswer } from '../services/answer/generate.js'
import { getLocalTimezone } from '../services/extract/timeParse.js'
import { searchAll } from '../services/search/searchAll.js'
import { condensateQuery } from '../services/search/condensateQuery.js'
import { validate, asyncHandler, createError, requireUser } from '../middleware/index.js'

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

const chatAskSchema = z.object({
  message: z.string().trim().min(1, '消息不能为空').max(5000, '消息过长（最多 5000 字符）'),
  /** 不传则不写库（纯问答）；传了则持久化用户消息与带 citations 的回答 */
  sessionId: z.string().max(64).nullable().optional(),
  libraryId: z.string().max(64).default('default'),
})

// ── 路由 ─────────────────────────────────────────────

/** POST /api/chat — 个人知识问答（spec 7 / 4.7） */
router.post(
  '/',
  validate({ body: chatAskSchema }),
  asyncHandler(async (req, res) => {
    const body = chatAskSchema.parse(req.body)
    const user = requireUser(req)
    const timezone = getLocalTimezone()
    const db = getDb()

    if (body.sessionId) {
      const rows = await db
        .select({ id: tables.sessions.id })
        .from(tables.sessions)
        .where(and(eq(tables.sessions.id, body.sessionId), eq(tables.sessions.userId, user.id)))
        .limit(1)
      if (!rows[0]) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')
    }

    // 历史只取当前问题之前的内容（4.6.1：最近 6 轮）
    const history: ChatMessage[] = body.sessionId
      ? (
          await db
            .select({ role: tables.messages.role, content: tables.messages.content })
            .from(tables.messages)
            .where(eq(tables.messages.sessionId, body.sessionId))
            .orderBy(desc(tables.messages.createdAt))
            .limit(12)
        )
          .reverse()
          .flatMap((row) =>
            row.role === 'user' || row.role === 'assistant'
              ? [{ role: row.role, content: row.content }]
              : [],
          )
      : []

    // ── Query Condensation：多轮对话查询凝练（spec 1.7）──
    // 话题门控 + LLM 改写，把追问还原成独立问题用于检索
    const enableCondensation = process.env.ENABLE_QUERY_CONDENSATION === '1'
    const enableTopicGate = process.env.CONDENSATION_TOPIC_GATE !== '0'
    let searchQuery = body.message
    if (enableCondensation && history.length > 0) {
      const result = await condensateQuery({
        query: body.message,
        history,
        enableTopicGate,
      })
      searchQuery = result.condensed
      if (result.rewritten) {
        logger.info('chat.route', '查询凝练完成', {
          original: body.message.slice(0, 60),
          condensed: result.condensed.slice(0, 60),
          topic: result.topic,
        })
      }
    }

    const search = await searchAll({
      query: searchQuery,
      libraryId: user.libraryId,
      timezone,
    })
    const answer = await generateAnswer({
      query: body.message,
      condensedQuery: searchQuery !== body.message ? searchQuery : undefined,
      search,
      history,
      timezone,
    })

    // ── 持久化：用户消息 + 带 citations 快照的回答（4.8） ──
    const now = new Date()
    let userMessageId: string | null = null
    let assistantMessageId: string | null = null
    if (body.sessionId) {
      userMessageId = randomUUID()
      assistantMessageId = randomUUID()
      await db.insert(tables.messages).values([
        {
          id: userMessageId,
          sessionId: body.sessionId,
          role: 'user',
          content: body.message,
          createdAt: now,
        },
        {
          id: assistantMessageId,
          sessionId: body.sessionId,
          role: 'assistant',
          content: answer.reply,
          citations: answer.citations as unknown as Record<string, unknown>[],
          metadata: {
            missing: answer.missing,
            degraded: answer.degraded,
            degradedReason: answer.degradedReason,
          },
          createdAt: new Date(now.getTime() + 1),
        },
      ])
      await db
        .update(tables.sessions)
        .set({ updatedAt: now })
        .where(eq(tables.sessions.id, body.sessionId))
    }

    logger.info('chat.route', 'POST / 完成', {
      sessionId: body.sessionId ?? null,
      citationCount: answer.citations.length,
      empty: answer.empty,
      general: answer.general,
      degraded: answer.degraded,
    })

    res.json({
      ok: true,
      reply: answer.reply,
      citations: answer.citations,
      missing: answer.missing,
      degraded: answer.degraded,
      degradedReason: answer.degradedReason,
      empty: answer.empty,
      general: answer.general,
      embeddingMock: search.embeddingMock,
      sessionId: body.sessionId ?? null,
      userMessageId,
      assistantMessageId,
    })
  }),
)

/** POST /api/chat/completions */
router.post(
  '/completions',
  validate({ body: chatCompletionsSchema }),
  asyncHandler(async (req, res) => {
    const { messages, model, stream, temperature } = req.body as z.infer<
      typeof chatCompletionsSchema
    >
    logger.info('chat.route', 'POST /completions — 入口', { stream, msgCount: messages.length })

    // 显式指定 model 时尊重调用方选择；否则按路由档位选择
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const chain = createChatChain({
      model,
      temperature,
      tier: model ? undefined : routeModel({ step: 'chat', query: lastUserMessage }).tier,
    })

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      for await (const delta of chain.stream({ messages, stream: true })) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
      }

      res.write('data: [DONE]\n\n')
      logger.info('chat.route', 'POST /completions — 出口 (stream)')
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
      logger.info('chat.route', 'POST /completions — 出口 (invoke)')
    }
  }),
)

/**
 * POST /api/chat/stream — 带「思考过程」的流式问答（SSE）
 *
 * 事件协议：
 *   thinking { text }   —— 真实处理阶段，前端以浅色打字机方式逐条展示
 *   answer   { text }   —— 完整回答，前端做打字机呈现
 *   meta     { ... }    —— 引用、降级、embeddingMock 等结构化信息
 *   error    { message }—— 失败提示
 *   done     {}         —— 结束
 *
 * 说明：当前模型（glm-4-flash）不返回隐藏推理内容，这里输出的是编排链路的
 * 真实阶段（理解 / 检索命中 / 组织回答），不是模型内部思维链。
 */
router.post(
  '/stream',
  validate({ body: chatAskSchema }),
  asyncHandler(async (req, res) => {
    const body = chatAskSchema.parse(req.body)
    const user = requireUser(req)
    const timezone = getLocalTimezone()
    const db = getDb()

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    let closed = false
    req.on('close', () => {
      closed = true
    })

    const send = (event: string, data: unknown): void => {
      if (closed) return
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    const think = (text: string): void => send('thinking', { text })

    // 思考/生成阶段可能持续十几秒，定期心跳避免被代理判定为空闲连接
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n')
    }, 10_000)
    heartbeat.unref()

    try {
      think('正在理解你的问题')

      if (body.sessionId) {
        const rows = await db
          .select({ id: tables.sessions.id })
          .from(tables.sessions)
          .where(and(eq(tables.sessions.id, body.sessionId), eq(tables.sessions.userId, user.id)))
          .limit(1)
        if (!rows[0]) throw createError('会话不存在', 404, 'SESSION_NOT_FOUND')
      }

      const history: ChatMessage[] = body.sessionId
        ? (
            await db
              .select({ role: tables.messages.role, content: tables.messages.content })
              .from(tables.messages)
              .where(eq(tables.messages.sessionId, body.sessionId))
              .orderBy(desc(tables.messages.createdAt))
              .limit(12)
          )
            .reverse()
            .flatMap((row) =>
              row.role === 'user' || row.role === 'assistant'
                ? [{ role: row.role, content: row.content }]
                : [],
            )
        : []

      // ── Query Condensation：把追问还原成可独立检索的问题 ──
      const enableCondensation = process.env.ENABLE_QUERY_CONDENSATION === '1'
      const enableTopicGate = process.env.CONDENSATION_TOPIC_GATE !== '0'
      let searchQuery = body.message
      if (enableCondensation && history.length > 0) {
        const result = await condensateQuery({
          query: body.message,
          history,
          enableTopicGate,
        })
        if (result.rewritten && result.condensed !== body.message) {
          searchQuery = result.condensed
          think(`结合上文补全问题：${searchQuery.slice(0, 80)}`)
        }
      }

      think('正在分析需要哪些信息')
      const search = await searchAll({
        query: searchQuery,
        libraryId: user.libraryId,
        timezone,
      })

      if (!search.understanding.needsPersonalContext) {
        think('这是通用问题，直接组织回答')
      } else if (search.empty) {
        think('没有找到相关记录')
      } else {
        const { channels } = search
        const parts = [
          channels.time > 0 ? `日程 ${channels.time}` : '',
          channels.entry > 0 ? `记录 ${channels.entry}` : '',
          channels.doc > 0 ? `资料 ${channels.doc}` : '',
        ].filter(Boolean)
        think(
          `检索到 ${search.results.length} 条相关记录${parts.length > 0 ? `（${parts.join(' · ')}）` : ''}`,
        )
      }

      think('正在组织回答')
      const answer = await generateAnswer({
        query: body.message,
        condensedQuery: searchQuery !== body.message ? searchQuery : undefined,
        search,
        history,
        timezone,
      })

      // ── 持久化：与 /api/chat 保持一致 ──
      const now = new Date()
      let userMessageId: string | null = null
      let assistantMessageId: string | null = null
      if (body.sessionId) {
        userMessageId = randomUUID()
        assistantMessageId = randomUUID()
        await db.insert(tables.messages).values([
          {
            id: userMessageId,
            sessionId: body.sessionId,
            role: 'user',
            content: body.message,
            createdAt: now,
          },
          {
            id: assistantMessageId,
            sessionId: body.sessionId,
            role: 'assistant',
            content: answer.reply,
            citations: answer.citations as unknown as Record<string, unknown>[],
            metadata: {
              missing: answer.missing,
              degraded: answer.degraded,
              degradedReason: answer.degradedReason,
            },
            createdAt: new Date(now.getTime() + 1),
          },
        ])
        await db
          .update(tables.sessions)
          .set({ updatedAt: now })
          .where(eq(tables.sessions.id, body.sessionId))
      }

      send('answer', { text: answer.reply })
      send('meta', {
        citations: answer.citations,
        missing: answer.missing,
        degraded: answer.degraded,
        degradedReason: answer.degradedReason,
        empty: answer.empty,
        general: answer.general,
        embeddingMock: search.embeddingMock,
        sessionId: body.sessionId ?? null,
        userMessageId,
        assistantMessageId,
      })

      logger.info('chat.route', 'POST /stream 完成', {
        sessionId: body.sessionId ?? null,
        citationCount: answer.citations.length,
        empty: answer.empty,
        general: answer.general,
      })
    } catch (err) {
      logger.error('chat.route', 'POST /stream 失败', {
        error: (err as Error).message.slice(0, 200),
      })
      send('error', { message: (err as Error).message || '回答失败，请稍后重试' })
    } finally {
      clearInterval(heartbeat)
      if (!closed) {
        send('done', {})
        res.end()
      }
    }
  }),
)

export default router
