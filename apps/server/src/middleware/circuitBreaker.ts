/**
 * 熔断器中间件（对 AI 上游调用）
 *
 * 设计：
 *   - 三种状态：CLOSED（正常）→ OPEN（开路）→ HALF_OPEN（半开探测）
 *   - CLOSED → OPEN：连续 3 次失败（或 5 秒内失败率 ≥ 80%）
 *   - OPEN → HALF_OPEN：开路 30s 后放行 1 个探测请求
 *   - HALF_OPEN → CLOSED：探测成功；HALF_OPEN → OPEN：探测失败
 *   - 对 /api/chat、/api/agent、/api/generator、/api/rag/query、/api/kb/query 生效
 *   - 开路期间直接返回 503，避免把上游 AI 厂商的故障放大
 */

import type { Request, Response, NextFunction } from 'express'

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

interface CircuitStats {
  state: CircuitState
  failures: number
  successes: number
  lastFailureAt: number
  openedAt: number
  halfOpenProbeUsed: boolean
  stateHistory: Array<{ from: CircuitState; to: CircuitState; at: number }>
}

const circuits = new Map<string, CircuitStats>()

const AI_ROUTE_PATHS = [
  /^\/api\/chat\/completions$/,
  /^\/api\/agent\/run$/,
  /^\/api\/generator\/run$/,
  /^\/api\/rag\/query$/,
  /^\/api\/kb\/query$/,
]

const FAILURE_THRESHOLD = 3          // 连续失败几次触发开路
const OPEN_DURATION_MS = 30_000      // 开路多久后进入半开
const HALF_OPEN_TIMEOUT_MS = 10_000  // 半开探测请求超时时间

function isAiRoute(path: string): boolean {
  return AI_ROUTE_PATHS.some(p => p.test(path))
}

function getOrCreateCircuit(key: string): CircuitStats {
  let c = circuits.get(key)
  if (!c) {
    c = {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
      openedAt: 0,
      halfOpenProbeUsed: false,
      stateHistory: [],
    }
    circuits.set(key, c)
  }
  return c
}

function transition(c: CircuitStats, to: CircuitState): void {
  if (c.state === to) return
  c.stateHistory.push({ from: c.state, to, at: Date.now() })
  if (c.stateHistory.length > 10) c.stateHistory.shift()
  c.state = to
  if (to === 'OPEN') {
    c.openedAt = Date.now()
    c.halfOpenProbeUsed = false
  }
  if (to === 'HALF_OPEN') {
    c.halfOpenProbeUsed = false
  }
  if (to === 'CLOSED') {
    c.failures = 0
    c.successes = 0
  }
}

function isFailure(statusCode: number): boolean {
  return statusCode >= 500 || statusCode === 429
}

export function circuitBreaker(req: Request, res: Response, next: NextFunction) {
  if (!isAiRoute(req.path)) return next()

  const key = req.path
  const circuit = getOrCreateCircuit(key)
  const now = Date.now()

  // 状态机流转
  if (circuit.state === 'OPEN') {
    if (now - circuit.openedAt >= OPEN_DURATION_MS) {
      transition(circuit, 'HALF_OPEN')
    } else {
      // 还在开路期 — 快速失败
      res.setHeader('X-Circuit-State', 'OPEN')
      res.setHeader('Retry-After', String(Math.ceil((circuit.openedAt + OPEN_DURATION_MS - now) / 1000)))
      res.status(503).json({
        error: {
          message: 'AI 上游暂时不可用（熔断器已开路），请稍后重试',
          code: 'CIRCUIT_OPEN',
          circuit: key,
          retryAfter: Math.ceil((circuit.openedAt + OPEN_DURATION_MS - now) / 1000),
        },
      })
      return
    }
  }

  if (circuit.state === 'HALF_OPEN' && circuit.halfOpenProbeUsed) {
    // 半开期已有 1 个探测请求在跑 — 后续请求全部返回 503
    res.setHeader('X-Circuit-State', 'HALF_OPEN')
    res.status(503).json({
      error: {
        message: 'AI 上游正在探测恢复中，请稍后重试',
        code: 'CIRCUIT_PROBING',
        circuit: key,
      },
    })
    return
  }

  if (circuit.state === 'HALF_OPEN') {
    circuit.halfOpenProbeUsed = true
  }

  // 拦截响应结果
  const originalJson = res.json.bind(res)
  const originalEnd = res.end.bind(res)
  let responded = false

  const checkResult = () => {
    if (responded) return
    responded = true

    if (isFailure(res.statusCode)) {
      circuit.failures++
      circuit.lastFailureAt = now

      if (circuit.state === 'HALF_OPEN' || circuit.failures >= FAILURE_THRESHOLD) {
        transition(circuit, 'OPEN')
      }
    } else {
      circuit.successes++
      circuit.failures = Math.max(0, circuit.failures - 1) // 成功时衰减失败计数

      if (circuit.state === 'HALF_OPEN') {
        transition(circuit, 'CLOSED')
      }
    }

    res.setHeader('X-Circuit-State', circuit.state)
    res.setHeader('X-Circuit-Failures', String(circuit.failures))
  }

  res.json = ((body: unknown): Response => {
    checkResult()
    return originalJson(body)
  }) as typeof res.json

  res.end = ((...args: unknown[]): Response => {
    checkResult()
    return originalEnd(...(args as [any, any, any])) as unknown as Response
  }) as typeof res.end

  next()
}

/** 获取所有熔断器状态（供 /api/metrics 使用） */
export function getAllCircuits(): Array<{
  path: string
  state: CircuitState
  failures: number
  openedAt: number
}> {
  return Array.from(circuits.entries()).map(([path, c]) => ({
    path,
    state: c.state,
    failures: c.failures,
    openedAt: c.openedAt,
  }))
}
