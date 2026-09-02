/**
 * LRU 内存缓存中间件
 *
 * 设计：
 *   - 仅缓存 GET 幂等接口，对 POST/PUT/DELETE 不生效
 *   - 容量上限 100 条，超出淘汰最久未使用
 *   - TTL 60s，过期自动失效
 *   - 命中时返回 304 + X-Cache: HIT，未命中时正常执行 + X-Cache: MISS
 *   - 可通过 ?_nocache=1 强制绕过（调试用）
 */

import type { Request, Response, NextFunction } from 'express'

interface CacheEntry {
  body: unknown
  status: number
  headers: Record<string, string>
  createdAt: number
  lastAccessed: number
}

const cache = new Map<string, CacheEntry>()
const MAX_SIZE = 100
const TTL_MS = 60_000

/** 需要缓存的 GET 路径（白名单） */
const CACHEABLE_PATHS = [
  /^\/api\/sessions$/,
  /^\/api\/documents$/,
  /^\/api\/tools\/list$/,
  /^\/api\/health$/,
]

function isCacheable(req: Request): boolean {
  if (req.method !== 'GET') return false
  if (req.query._nocache === '1') return false
  return CACHEABLE_PATHS.some(p => p.test(req.path))
}

function makeKey(req: Request): string {
  const url = new URL(req.originalUrl, 'http://x')
  url.searchParams.delete('_nocache')
  return `${req.method}:${url.pathname}${url.search}`
}

function evictLRU(): void {
  if (cache.size >= MAX_SIZE) {
    let oldest: string | null = null
    let oldestTime = Infinity
    for (const [key, entry] of cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed
        oldest = key
      }
    }
    if (oldest) cache.delete(oldest)
  }
}

function cleanExpired(): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > TTL_MS) cache.delete(key)
  }
}

setInterval(cleanExpired, 30_000).unref()

/** 手动清除缓存（供 POST/PUT/DELETE 路由调用） */
export function clearCache(key?: string): void {
  if (key) cache.delete(key)
  else cache.clear()
}

/** 获取缓存状态（供 /api/metrics 使用） */
export function getCacheStats(): { size: number; hitRate: number; hits: number; misses: number } {
  return { size: cache.size, hitRate: hitRate(), hits, misses }
}

let hits = 0
let misses = 0
function hitRate(): number {
  const total = hits + misses
  return total === 0 ? 0 : hits / total
}

export function cacheMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isCacheable(req)) return next()

  const key = makeKey(req)
  const now = Date.now()
  const entry = cache.get(key)

  if (entry && now - entry.createdAt < TTL_MS) {
    // 命中
    hits++
    entry.lastAccessed = now
    res.setHeader('X-Cache', 'HIT')
    res.setHeader('X-Cache-Age', String(Math.floor((now - entry.createdAt) / 1000)))
    res.status(entry.status).json(entry.body)
    return
  }

  // 未命中 — 拦截 res.json() 存入缓存
  misses++
  res.setHeader('X-Cache', 'MISS')

  const originalJson = res.json.bind(res)
  res.json = (body: unknown): Response => {
    evictLRU()
    cache.set(key, {
      body,
      status: res.statusCode,
      headers: { 'content-type': res.getHeader('content-type') as string || 'application/json' },
      createdAt: now,
      lastAccessed: now,
    })
    return originalJson(body)
  }

  next()
}
