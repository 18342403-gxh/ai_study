/**
 * 等待 HTTP 端口就绪
 * 轮询 GET {url}/health 或 HEAD {url}，超时抛错。
 * Electron 主进程 spawn 子进程后，必须等它真的开始监听再创建窗口。
 */

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_INTERVAL_MS = 500

export interface WaitPortOptions {
  timeoutMs?: number
  intervalMs?: number
  path?: string  // 健康检查路径，默认 /
}

export async function waitForPort(
  url: string,
  opts: WaitPortOptions = {},
): Promise<void> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS, path = '/' } = opts
  const deadline = Date.now() + timeoutMs
  const fullUrl = url.replace(/\/$/, '') + path

  while (Date.now() < deadline) {
    try {
      const res = await fetch(fullUrl, { method: 'HEAD' })
      if (res.ok || res.status === 404) {
        // 404 也算端口已就绪（只是路径不对，但 server 在监听）
        return
      }
      // GET /api/health 时看 2xx
      if (res.status >= 200 && res.status < 500) return
    } catch {
      // 连接被拒 / DNS 未解析 — 继续等
    }
    await sleep(intervalMs)
  }
  throw new Error(`waitForPort: ${url}${path} 超时 ${timeoutMs}ms`)
}

export async function waitForJsonEndpoint(
  url: string,
  path: string,
  opts: WaitPortOptions = {},
): Promise<void> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS } = opts
  const deadline = Date.now() + timeoutMs
  const fullUrl = url.replace(/\/$/, '') + path

  while (Date.now() < deadline) {
    try {
      const res = await fetch(fullUrl)
      if (res.ok) {
        try {
          const json = await res.json()
          if (json?.status === 'ok') return
        } catch {
          // 不是 JSON 但 HTTP 200 — 也算就绪
          return
        }
      }
    } catch {
      // 未就绪
    }
    await sleep(intervalMs)
  }
  throw new Error(`waitForJsonEndpoint: ${url}${path} 超时 ${timeoutMs}ms`)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
