/**
 * 监控指标中间件
 *
 * 功能：
 *   - 收集请求计数（按 method + path + status）
 *   - 收集响应时间（计算 P50 / P95 / P99 延迟）
 *   - 活跃连接数
 *   - 暴露 GET /api/metrics 端点输出 JSON（Prometheus 可 scrape）
 *
 * 注意：这是轻量级内存指标，生产级应接入 Prometheus + Grafana，
 * 这里的目的是让项目具备"可观测"能力而不是替代完整监控。
 */

import type { Request, Response, NextFunction } from 'express'
import { getAllCircuits } from './circuitBreaker.js'
import { getCacheStats } from './cache.js'

interface RequestBucket {
  count: number
  errors: number // 4xx + 5xx
  durations: number[] // ms
}

const buckets = new Map<string, RequestBucket>() // key: "METHOD:path"
const MAX_DURATIONS_PER_BUCKET = 500 // 每个 bucket 最多保留 500 条延迟样本

let activeConnections = 0
let startedAt = Date.now()

function bucketKey(method: string, path: string): string {
  return `${method}:${path}`
}

function getBucket(method: string, path: string): RequestBucket {
  const key = bucketKey(method, path)
  let b = buckets.get(key)
  if (!b) {
    b = { count: 0, errors: 0, durations: [] }
    buckets.set(key, b)
  }
  return b
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

export function metricsMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (req.path === '/api/metrics') return next() // 不统计 metrics 端点本身

  activeConnections++
  const start = process.hrtime.bigint()

  _res.on('finish', () => {
    activeConnections--
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6
    const bucket = getBucket(req.method, req.path)
    bucket.count++
    if (_res.statusCode >= 400) bucket.errors++

    bucket.durations.push(durationMs)
    if (bucket.durations.length > MAX_DURATIONS_PER_BUCKET) {
      bucket.durations.shift()
    }
  })

  next()
}

/**
 * GET /api/metrics — 返回汇总指标
 */
export function metricsHandler(_req: Request, res: Response) {
  const now = Date.now()

  let totalRequests = 0
  let totalErrors = 0
  const allDurations: number[] = []
  const perRoute: Array<{
    method: string
    path: string
    count: number
    errors: number
    avgMs: number
    p95Ms: number
  }> = []

  for (const [key, bucket] of buckets) {
    const [method, ...rest] = key.split(':')
    const path = rest.join(':')

    totalRequests += bucket.count
    totalErrors += bucket.errors
    allDurations.push(...bucket.durations)

    const sorted = [...bucket.durations].sort((a, b) => a - b)
    perRoute.push({
      method,
      path,
      count: bucket.count,
      errors: bucket.errors,
      avgMs: bucket.durations.length > 0 ? bucket.durations.reduce((a, b) => a + b, 0) / bucket.durations.length : 0,
      p95Ms: percentile(sorted, 95),
    })
  }

  const sortedAll = [...allDurations].sort((a, b) => a - b)

  res.json({
    server: {
      uptimeSec: Math.floor((now - startedAt) / 1000),
      activeConnections,
    },
    requests: {
      total: totalRequests,
      errors: totalErrors,
      errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
      avgLatencyMs: allDurations.length > 0 ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length : 0,
      p50LatencyMs: percentile(sortedAll, 50),
      p95LatencyMs: percentile(sortedAll, 95),
      p99LatencyMs: percentile(sortedAll, 99),
    },
    perRoute: perRoute.sort((a, b) => b.count - a.count).slice(0, 30),
    circuits: getAllCircuits(),
    cache: getCacheStats(),
  })
}

/** 重置指标（测试/部署后调用） */
export function resetMetrics(): void {
  buckets.clear()
  startedAt = Date.now()
}
