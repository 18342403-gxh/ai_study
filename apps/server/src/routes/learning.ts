/**
 * 学习 API — GitHub 项目检索
 *
 * POST /api/learning/search
 *   ① 用模型把自然语言需求解析成搜索条件（失败回退规则）
 *   ② 调 GitHub Search API
 *   ③ 超时 / 限流作为独立业务状态返回，前端展示专用提示
 *
 * 分页：
 *   - page=1 时解析意图并合并多个候选查询，返回 resolvedQuery（实际用于翻页的查询）
 *   - page>1 时带上 resolvedQuery，直接请求 GitHub 的对应页，不再重复解析
 *
 * 当前不做 Gitee 兜底；GITEE_* 相关能力后续再开。
 */

import { Router } from 'express'
import { z } from 'zod'

import {
  buildGithubQuery,
  parseSearchIntent,
  type ParsedIntent,
} from '../services/learning/keywords.js'
import {
  searchRepos,
  type GithubSearchOutcome,
  type RepoItem,
  type RepoSort,
} from '../services/learning/github.js'
import { asyncHandler, requireUser, validate } from '../middleware/index.js'
import { logger } from '../services/logger.js'

const router = Router()

const searchSchema = z.object({
  query: z.string().trim().min(1, '请输入想找的项目描述').max(200, '描述过长（最多 200 字）'),
  limit: z.number().int().min(3).max(30).default(20),
  page: z.number().int().min(1).max(50).default(1),
  /** 翻页用：第一页返回的实际查询串 */
  resolvedQuery: z.string().trim().min(1).max(300).optional(),
  sort: z.enum(['stars', 'updated', 'best-match']).optional(),
})

type LearningErrorCode = 'GITHUB_TIMEOUT' | 'GITHUB_RATE_LIMITED' | 'GITHUB_ERROR'

interface LearningSearchResponse {
  ok: boolean
  code?: LearningErrorCode
  message?: string
  items?: RepoItem[]
  total?: number
  parsed?: ParsedIntent
  cached?: boolean
  elapsedMs?: number
  page?: number
  hasMore?: boolean
  resolvedQuery?: string
}

/** GitHub Search 最多只能翻到 1000 条 */
const MAX_RESULTS = 1000

/** 结果缓存：同一描述 60 秒内复用，节省 GitHub 匿名额度（10 次/分钟全站共享） */
const CACHE_TTL_MS = 60_000
const CACHE_MAX = 50
const cache = new Map<string, { at: number; body: LearningSearchResponse }>()

const cacheKey = (query: string, limit: number, page: number, resolved?: string): string =>
  `${query.trim().toLowerCase()}|${limit}|${page}|${resolved ?? ''}`

const errorCodeOf = (reason: 'timeout' | 'rate_limited' | 'error'): LearningErrorCode =>
  reason === 'timeout'
    ? 'GITHUB_TIMEOUT'
    : reason === 'rate_limited'
      ? 'GITHUB_RATE_LIMITED'
      : 'GITHUB_ERROR'

const isMore = (page: number, limit: number, total: number): boolean =>
  page * limit < Math.min(total, MAX_RESULTS)

/** POST /api/learning/search */
router.post(
  '/search',
  validate({ body: searchSchema }),
  asyncHandler(async (req, res) => {
    requireUser(req)
    const { query, limit, page, resolvedQuery, sort: rawSort } = searchSchema.parse(req.body)
    const startedAt = Date.now()

    const key = cacheKey(query, limit, page, resolvedQuery)
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      res.json({ ...hit.body, cached: true })
      return
    }

    // ── 翻页：直接复用第一页确定下来的查询，不再解析意图 ──
    if (page > 1 && resolvedQuery) {
      const sort: RepoSort = rawSort === 'updated' ? 'stars' : (rawSort ?? 'best-match')
      const outcome = await searchRepos({ q: resolvedQuery, sort, limit, page })
      if (!outcome.ok) {
        logger.warn('learning.search', 'GitHub 翻页失败', {
          reason: outcome.reason,
          q: resolvedQuery,
        })
        res.json({
          ok: false,
          code: errorCodeOf(outcome.reason),
          message: outcome.message,
          page,
          elapsedMs: Date.now() - startedAt,
        })
        return
      }

      const body: LearningSearchResponse = {
        ok: true,
        items: outcome.items,
        total: outcome.total,
        page,
        hasMore: isMore(page, limit, outcome.total),
        resolvedQuery,
        cached: false,
        elapsedMs: Date.now() - startedAt,
      }
      if (cache.size >= CACHE_MAX) cache.clear()
      cache.set(key, { at: Date.now(), body })
      res.json(body)
      return
    }

    const intent = await parseSearchIntent(query)

    // 候选查询：完整条件 → 逐步放宽（去语言、减关键词）→ 模型给的近义说法
    const candidates = [
      buildGithubQuery(intent),
      intent.keywords.join(' '),
      intent.keywords.slice(0, 2).join(' '),
      intent.keywords[0],
      ...intent.alternatives,
    ].filter(Boolean)

    // 「活跃」意图用 star 排序 + pushed 时间窗，避免按 updated 排序时满是零星新仓库
    const effectiveSort = intent.sort === 'updated' ? 'stars' : intent.sort

    // 多个候选查询的结果合并去重：优先保证召回数量，最多消耗 3 次匿名额度
    const items: RepoItem[] = []
    const seen = new Set<number>()
    let total = 0
    let usedQuery = ''
    let attempts = 0
    let lastError: Extract<GithubSearchOutcome, { ok: false }> | null = null
    // 翻页锚点：贡献条目最多的候选查询，第二页从这里继续
    let pageQuery = ''
    let pageQueryTotal = 0
    let bestContribution = 0

    for (const candidate of [...new Set(candidates)]) {
      if (attempts >= 3 || items.length >= limit) break
      attempts += 1
      usedQuery = candidate
      const outcome = await searchRepos({ q: candidate, sort: effectiveSort, limit })
      if (!outcome.ok) {
        lastError = outcome
        continue
      }
      total = Math.max(total, outcome.total)
      let added = 0
      for (const item of outcome.items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        items.push(item)
        added += 1
        if (items.length >= limit) break
      }
      if (added > bestContribution) {
        bestContribution = added
        pageQuery = candidate
        pageQueryTotal = outcome.total
      }
    }

    if (items.length === 0 && lastError) {
      logger.warn('learning.search', 'GitHub 检索失败', {
        reason: lastError.reason,
        q: usedQuery,
      })
      res.json({
        ok: false,
        code: errorCodeOf(lastError.reason),
        message: lastError.message,
        parsed: intent,
        elapsedMs: Date.now() - startedAt,
      })
      return
    }

    const body: LearningSearchResponse = {
      ok: true,
      items,
      total,
      parsed: intent,
      cached: false,
      elapsedMs: Date.now() - startedAt,
      page: 1,
      hasMore: pageQuery !== '' && isMore(1, limit, pageQueryTotal),
      resolvedQuery: pageQuery || usedQuery,
    }

    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(key, { at: Date.now(), body })

    logger.info('learning.search', '检索完成', {
      q: usedQuery,
      count: items.length,
      total,
      attempts,
      pageQuery,
      costMs: body.elapsedMs,
    })

    res.json(body)
  }),
)

export default router
