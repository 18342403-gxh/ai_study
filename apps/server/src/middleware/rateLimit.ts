/**
 * 令牌桶限流中间件
 *
 * 设计：
 *   - 基于 IP 维度限流，用滑动时间窗口（1 分钟桶）实现
 *   - 普通接口 60 req/min，SSE 流式接口 10 req/min（AI 调用成本高）
 *   - 白名单路径（/api/health, /api/metrics）不限
 *   - 超限返回 429 + Retry-After 头
 */

import type { Request, Response, NextFunction } from 'express'

interface Bucket {
  timestamps: number[] // 最近一分钟内的请求时间戳
}

const buckets = new Map<string, Bucket>()

/** 不同路由的限流配置 */
const SSE_PATHS = [/^\/api\/chat\/completions$/, /^\/api\/agent\/run$/, /^\/api\/generator\/run$/, /^\/api\/rag\/query$/, /^\/api\/kb\/query$/]
const WHITELIST_PATHS = [/^\/api\/health$/, /^\/api\/metrics$/]

const NORMAL_WINDOW_MS = 60_000
const NORMAL_MAX = 60
const SSE_WINDOW_MS = 60_000
const SSE_MAX = 10

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string') return xff.split(',')[0].trim()
  if (Array.isArray(xff)) return xff[0].trim()
  return req.ip || req.socket.remoteAddress || 'unknown'
}

function isSsePath(path: string): boolean {
  return SSE_PATHS.some(p => p.test(path))
}

function isWhitelisted(path: string): boolean {
  return WHITELIST_PATHS.some(p => p.test(path))
}

function cleanup(): void {
  const now = Date.now()
  for (const [ip, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter(t => now - t < NORMAL_WINDOW_MS)
    if (bucket.timestamps.length === 0) buckets.delete(ip)
  }
}

// 每 30 秒清理过期 bucket，防止内存泄漏
setInterval(cleanup, 30_000).unref()

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const path = req.path

  if (isWhitelisted(path)) return next()

  const ip = getClientIp(req)
  const now = Date.now()
  const isSse = isSsePath(path)
  const windowMs = isSse ? SSE_WINDOW_MS : NORMAL_WINDOW_MS
  const max = isSse ? SSE_MAX : NORMAL_MAX

  let bucket = buckets.get(ip)
  if (!bucket) {
    bucket = { timestamps: [] }
    buckets.set(ip, bucket)
  }

  bucket.timestamps = bucket.timestamps.filter(t => now - t < windowMs)

  if (bucket.timestamps.length >= max) {
    const retryAfter = Math.ceil((bucket.timestamps[0] + windowMs - now) / 1000)
    res.setHeader('Retry-After', String(retryAfter))
    res.setHeader('X-RateLimit-Limit', String(max))
    res.setHeader('X-RateLimit-Remaining', '0')
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((bucket.timestamps[0] + windowMs) / 1000)))
    res.status(429).json({
      error: {
        message: isSse
          ? '流式接口限流（保护 AI 厂商配额），请稍后重试'
          : '请求过于频繁，请稍后重试',
        code: 'RATE_LIMITED',
        retryAfter,
      },
    })
    return
  }

  bucket.timestamps.push(now)

  res.setHeader('X-RateLimit-Limit', String(max))
  res.setHeader('X-RateLimit-Remaining', String(max - bucket.timestamps.length))
  res.setHeader('X-RateLimit-Reset', String(Math.ceil((bucket.timestamps[0] + windowMs) / 1000)))

  next()
}
