/**
 * 出站 URL 安全校验（SSRF 防护）
 *
 * 仅允许 http/https；拒绝带凭据 URL；DNS 解析后拒绝私网/回环/保留地址；
 * 重定向手动跟随、逐跳重新校验、最多 3 跳。
 *
 * 开关：URL_GUARD=0 可关闭 DNS 解析校验（协议与凭据校验始终保留）。
 * 失败信息保持可读，不把内部 IP 暴露给调用方/前端。
 */

import { lookup as dnsLookup } from 'node:dns/promises'

export type UrlGuardCode =
  | 'UNSAFE_PROTOCOL'
  | 'UNSAFE_CREDENTIALS'
  | 'UNSAFE_HOST'
  | 'UNSAFE_RESOLVE'
  | 'TOO_MANY_REDIRECTS'

export class UrlGuardError extends Error {
  readonly code: UrlGuardCode

  constructor(code: UrlGuardCode, message: string) {
    super(message)
    this.name = 'UrlGuardError'
    this.code = code
  }
}

export type ResolveHost = (hostname: string) => Promise<string[]>

export interface UrlGuardDeps {
  /** 测试注入：DNS 解析；默认使用系统 resolver */
  resolve?: ResolveHost
  /** 测试注入：fetch 实现 */
  fetchImpl?: typeof fetch
}

export const MAX_REDIRECTS = 3

/** URL_GUARD 默认开启（安全类默认开）。 */
export const isUrlGuardEnabled = (): boolean => process.env.URL_GUARD !== '0'

const stripBrackets = (host: string): string => host.toLowerCase().replace(/^\[|\]$/g, '')

const isPrivateIpv4 = (ip: string): boolean => {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false
  }
  const [a, b, c] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // 保留/文档地址
  if (a === 198 && (b === 18 || b === 19)) return true // 基准测试段
  if (a === 198 && b === 51 && c === 100) return true // 文档地址
  if (a === 203 && b === 0 && c === 113) return true // 文档地址
  if (a >= 224) return true // 组播 + 保留
  return false
}

/** 提取 IPv4-mapped IPv6（::ffff:1.2.3.4 / ::ffff:7f00:1）中的 IPv4 部分 */
const ipv4FromMapped = (ip: string): string | null => {
  const lower = ip.toLowerCase()
  if (!lower.startsWith('::ffff:')) return null
  const rest = lower.slice('::ffff:'.length)
  if (rest.includes('.')) return rest
  const groups = rest.split(':')
  if (groups.length !== 2) return null
  const high = Number.parseInt(groups[0], 16)
  const low = Number.parseInt(groups[1], 16)
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
}

export const isPrivateIp = (raw: string): boolean => {
  const ip = stripBrackets(raw).trim()
  if (ip === '') return true

  if (ip.includes(':')) {
    const mapped = ipv4FromMapped(ip)
    if (mapped) return isPrivateIpv4(mapped)
    if (ip === '::' || ip === '::1') return true
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true // fc00::/7 ULA
    if (/^fe[89ab]/.test(ip)) return true // fe80::/10 link-local
    if (ip.startsWith('ff')) return true // ff00::/8 组播
    return false
  }

  return isPrivateIpv4(ip)
}

const PRIVATE_HOST_SUFFIXES = ['.localhost', '.local', '.internal']

/** 主机名层面的拒绝（未做 DNS 解析前即可判定） */
export const isPrivateHostname = (hostname: string): boolean => {
  const host = stripBrackets(hostname).replace(/\.$/, '')
  if (host === '' || host === 'localhost' || host === '0.0.0.0') return true
  if (host === '::1') return true
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true
  // IP 字面量直接判私网
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return isPrivateIp(host)
  return false
}

/** 同步校验：协议 + 凭据 + 主机名字面量（不做 DNS） */
export const assertSafeUrlSync = (rawUrl: string): URL => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UrlGuardError('UNSAFE_PROTOCOL', '网页地址格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlGuardError('UNSAFE_PROTOCOL', '网页地址只支持 HTTP/HTTPS')
  }
  if (url.username || url.password) {
    throw new UrlGuardError('UNSAFE_CREDENTIALS', '网页地址不能包含账号或密码')
  }
  if (isPrivateHostname(url.hostname)) {
    throw new UrlGuardError('UNSAFE_HOST', '不允许读取本机或内网地址')
  }
  return url
}

const defaultResolve: ResolveHost = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

/**
 * 异步校验：同步规则 + DNS 解析后拒绝私网地址。
 * URL_GUARD=0 时跳过 DNS 解析（协议/凭据/私网字面量仍拦截）。
 */
export const assertSafeUrl = async (rawUrl: string, deps: UrlGuardDeps = {}): Promise<URL> => {
  const url = assertSafeUrlSync(rawUrl)
  if (!isUrlGuardEnabled()) return url

  const host = stripBrackets(url.hostname)
  // IP 字面量已在上一步判定，无需再解析
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
  if (isIpLiteral) return url

  const resolve = deps.resolve ?? defaultResolve
  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new UrlGuardError('UNSAFE_RESOLVE', '无法解析该网页地址')
  }
  if (addresses.length === 0) {
    throw new UrlGuardError('UNSAFE_RESOLVE', '无法解析该网页地址')
  }
  // 任意一个解析结果落在私网即拒绝（防止 DNS 轮询绕过）
  if (addresses.some((address) => isPrivateIp(address))) {
    throw new UrlGuardError('UNSAFE_HOST', '不允许读取本机或内网地址')
  }
  return url
}

export interface GuardedFetchResult {
  response: Response
  /** 实际请求的最终地址（手动跟随重定向后） */
  finalUrl: string
  redirects: number
}

/**
 * 带 URL 守卫的 fetch：手动跟随重定向，每一跳都重新做完整校验。
 * 只返回非重定向响应（3xx 在内部消化），调用方继续处理状态码与内容类型。
 */
export const guardedFetch = async (
  rawUrl: string,
  init: RequestInit = {},
  deps: UrlGuardDeps = {},
): Promise<GuardedFetchResult> => {
  const fetchImpl = deps.fetchImpl ?? fetch
  let current = rawUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafeUrl(current, deps)
    const response = await fetchImpl(url, { ...init, redirect: 'manual' })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw new UrlGuardError(
          'UNSAFE_PROTOCOL',
          `网页返回 HTTP ${response.status}，但没有跳转地址`,
        )
      }
      if (hop === MAX_REDIRECTS) {
        throw new UrlGuardError('TOO_MANY_REDIRECTS', '网页跳转次数过多')
      }
      current = new URL(location, url).toString()
      continue
    }

    return { response, finalUrl: url.toString(), redirects: hop }
  }

  throw new UrlGuardError('TOO_MANY_REDIRECTS', '网页跳转次数过多')
}
