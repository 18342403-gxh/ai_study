/** 联网工具的外部 HTTP 适配层：搜索、新闻、天气与网页正文读取。 */

import { logger } from '../logger.js'

export type FetchLike = typeof fetch
export type SearchProvider = 'bing' | 'zhipu' | 'auto'
export type SearchRecency = 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear' | 'noLimit'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
  publishedAt: string | null
}

export interface WebSearchOptions {
  query: string
  count?: number
  recency?: SearchRecency
  provider?: SearchProvider
  fetchImpl?: FetchLike
  now?: number
}

const USER_AGENT = 'ai-study-common-tools/1.0'
const timeoutMs = (): number =>
  Math.max(1000, Number.parseInt(process.env.TOOL_HTTP_TIMEOUT_MS || '15000', 10) || 15_000)

const decodeEntities = (text: string): string => {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code: string) => {
    if (code[0] === '#') {
      const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10
      const value = Number.parseInt(code.slice(radix === 16 ? 2 : 1), radix)
      return Number.isFinite(value) ? String.fromCodePoint(value) : entity
    }
    return named[code.toLowerCase()] ?? entity
  })
}

const cleanText = (text: string): string =>
  decodeEntities(decodeEntities(text).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

const rssTag = (block: string, tag: string): string => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block)
  if (!match) return ''
  const cdata = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
  return tag === 'description' ? cleanText(cdata) : decodeEntities(cdata).trim()
}

/** 解析 Bing RSS；保持为独立函数，便于用固定 XML 做单测。 */
export const parseRssResults = (xml: string): SearchResult[] =>
  (xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []).flatMap((block) => {
    const title = rssTag(block, 'title')
    const url = rssTag(block, 'link')
    if (!title || !url) return []
    let source = ''
    try {
      source = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      source = '未知来源'
    }
    return [
      {
        title,
        url,
        snippet: rssTag(block, 'description'),
        source,
        publishedAt: rssTag(block, 'pubDate') || null,
      },
    ]
  })

const requestText = async (
  url: string | URL,
  fetchImpl: FetchLike,
  init: RequestInit = {},
): Promise<{ response: Response; text: string }> => {
  const response = await fetchImpl(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(timeoutMs()),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}`)
  }
  return { response, text: await response.text() }
}

const RECENCY_MS: Record<Exclude<SearchRecency, 'noLimit'>, number> = {
  oneDay: 24 * 60 * 60 * 1000,
  oneWeek: 7 * 24 * 60 * 60 * 1000,
  oneMonth: 30 * 24 * 60 * 60 * 1000,
  oneYear: 365 * 24 * 60 * 60 * 1000,
}

const filterRecency = (
  results: SearchResult[],
  recency: SearchRecency,
  now: number,
): SearchResult[] => {
  if (recency === 'noLimit') return results
  const cutoff = now - RECENCY_MS[recency]
  // RSS 中缺少日期的条目保留，并把日期为空的事实交给模型，避免误称发布日期。
  return results.filter((item) => {
    if (!item.publishedAt) return true
    const published = Date.parse(item.publishedAt)
    return Number.isNaN(published) || published >= cutoff
  })
}

const bingSearch = async (
  options: Required<Pick<WebSearchOptions, 'query'>> & WebSearchOptions,
) => {
  const count = Math.min(10, Math.max(1, options.count ?? 5))
  const recency = options.recency ?? 'noLimit'
  const url = new URL('https://www.bing.com/search')
  url.search = new URLSearchParams({
    format: 'rss',
    q: options.query,
    // 当前网络下 zh-CN RSS 会返回空 channel；en-US 市场仍可正常返回中文结果。
    mkt: 'en-US',
    setlang: 'en',
    count: String(count),
  }).toString()
  const { text } = await requestText(url, options.fetchImpl ?? fetch)
  const results = filterRecency(parseRssResults(text), recency, options.now ?? Date.now())
  return { provider: 'bing-rss', query: options.query, results: results.slice(0, count) }
}

const zhipuSearch = async (
  options: Required<Pick<WebSearchOptions, 'query'>> & WebSearchOptions,
) => {
  const apiKey = process.env.AI_API_KEY || process.env.GLM_API_KEY || ''
  if (!apiKey) throw new Error('使用智谱搜索需要配置 AI_API_KEY')
  const apiUrl = (process.env.AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(
    /\/+$/,
    '',
  )
  const { text } = await requestText(`${apiUrl}/web_search`, options.fetchImpl ?? fetch, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      search_query: options.query,
      search_engine: process.env.SEARCH_ENGINE || 'search_std',
      search_intent: false,
      count: Math.min(50, Math.max(1, options.count ?? 5)),
      search_recency_filter: options.recency ?? 'noLimit',
      content_size: 'medium',
    }),
  })
  const data = JSON.parse(text) as {
    error?: { message?: string; code?: string }
    search_result?: Array<{
      title?: string
      link?: string
      content?: string
      media?: string
      publish_date?: string
    }>
  }
  if (data.error) {
    throw new Error(`智谱搜索失败 ${data.error.code ?? ''}：${data.error.message ?? '未知错误'}`)
  }
  const results = (data.search_result ?? []).flatMap((item) => {
    if (!item.title || !item.link) return []
    return [
      {
        title: item.title,
        url: item.link,
        snippet: item.content ?? '',
        source: item.media ?? '',
        publishedAt: item.publish_date ?? null,
      },
    ]
  })
  return {
    provider: 'zhipu',
    query: options.query,
    results: results.slice(0, Math.min(50, Math.max(1, options.count ?? 5))),
  }
}

export const webSearch = async (options: WebSearchOptions) => {
  const query = options.query.trim()
  if (!query) throw new Error('搜索关键词不能为空')
  const provider = options.provider ?? (process.env.SEARCH_PROVIDER as SearchProvider) ?? 'bing'
  const normalized = { ...options, query }
  if (provider === 'bing') return bingSearch(normalized)
  if (provider === 'zhipu') return zhipuSearch(normalized)
  if (provider !== 'auto') throw new Error(`未知搜索提供方：${provider}`)

  if (process.env.AI_API_KEY || process.env.GLM_API_KEY) {
    try {
      return await zhipuSearch(normalized)
    } catch (error) {
      logger.warn('tools.search', '智谱搜索失败，自动降级到 Bing RSS', {
        error: (error as Error).message,
      })
    }
  }
  return bingSearch(normalized)
}

interface WeatherValues {
  value: string
}

interface WttrCondition {
  temp_C?: string
  FeelsLikeC?: string
  humidity?: string
  windspeedKmph?: string
  weatherDesc?: WeatherValues[]
  lang_zh?: WeatherValues[]
}

const weatherText = (condition: WttrCondition): string =>
  condition.lang_zh?.[0]?.value ?? condition.weatherDesc?.[0]?.value ?? '未知'

export const getWeather = async (params: {
  location: string
  days?: number
  fetchImpl?: FetchLike
}) => {
  const location = params.location.trim()
  if (!location) throw new Error('城市不能为空')
  const days = Math.min(3, Math.max(1, Math.floor(params.days ?? 1)))
  const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=zh`
  const { text } = await requestText(url, params.fetchImpl ?? fetch)
  const data = JSON.parse(text) as {
    current_condition?: WttrCondition[]
    nearest_area?: Array<{
      areaName?: WeatherValues[]
      region?: WeatherValues[]
      country?: WeatherValues[]
    }>
    weather?: Array<{
      date?: string
      mintempC?: string
      maxtempC?: string
      hourly?: WttrCondition[]
    }>
  }
  const current = data.current_condition?.[0]
  if (!current) throw new Error('天气服务未返回当前天气')

  const area = data.nearest_area?.[0]
  const resolvedLocation = [
    area?.areaName?.[0]?.value,
    area?.region?.[0]?.value,
    area?.country?.[0]?.value,
  ]
    .filter(
      (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
    )
    .join('，')

  return {
    provider: 'wttr.in',
    location: resolvedLocation || location,
    current: {
      temperatureC: current.temp_C ?? null,
      feelsLikeC: current.FeelsLikeC ?? null,
      humidityPct: current.humidity ?? null,
      windKmph: current.windspeedKmph ?? null,
      description: weatherText(current),
    },
    forecast: (data.weather ?? []).slice(0, days).map((day) => ({
      date: day.date ?? null,
      minTemperatureC: day.mintempC ?? null,
      maxTemperatureC: day.maxtempC ?? null,
      description: weatherText(day.hourly?.[Math.floor((day.hourly?.length ?? 1) / 2)] ?? {}),
    })),
  }
}

const isPrivateHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (
    host === '::1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    return true
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!ipv4) return false
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

export const validatePublicHttpUrl = (rawUrl: string): URL => {
  const url = new URL(rawUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('网页地址只支持 HTTP/HTTPS')
  }
  if (url.username || url.password) throw new Error('网页地址不能包含账号或密码')
  if (isPrivateHostname(url.hostname)) throw new Error('不允许读取本机或内网地址')
  return url
}

export const htmlToText = (html: string): { title: string | null; content: string } => {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const content = html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join('\n')
  return { title: titleMatch ? cleanText(titleMatch[1]) : null, content }
}

export const fetchUrlText = async (params: {
  url: string
  maxChars?: number
  fetchImpl?: FetchLike
}) => {
  const fetchImpl = params.fetchImpl ?? fetch
  let current = validatePublicHttpUrl(params.url).toString()
  let response: Response | undefined
  let text = ''
  let contentType = ''

  for (let redirects = 0; redirects <= 3; redirects++) {
    validatePublicHttpUrl(current)
    response = await fetchImpl(current, {
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html, text/plain, application/json, application/xml',
      },
      signal: AbortSignal.timeout(timeoutMs()),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`网页返回 HTTP ${response.status}，但没有跳转地址`)
      if (redirects === 3) throw new Error('网页跳转次数过多')
      current = new URL(location, current).toString()
      continue
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300)
      throw new Error(`网页读取失败 HTTP ${response.status}${detail ? `：${detail}` : ''}`)
    }

    contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const supported =
      contentType.startsWith('text/') ||
      /application\/(?:json|xml|xhtml\+xml)/.test(contentType) ||
      contentType === ''
    if (!supported) throw new Error(`不支持读取该内容类型：${contentType}`)
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > 2_000_000) throw new Error('网页内容过大（超过 2 MB）')
    text = await response.text()
    break
  }

  if (!response) throw new Error('网页读取失败')
  const maxChars = Math.min(20_000, Math.max(500, Math.floor(params.maxChars ?? 6000)))
  const isHtml = contentType.includes('html') || /^\s*<!doctype html|^\s*<html/i.test(text)
  const parsed = isHtml ? htmlToText(text) : { title: null, content: cleanText(text) }
  return {
    url: response.url || current,
    title: parsed.title,
    content: parsed.content.slice(0, maxChars),
    truncated: parsed.content.length > maxChars,
  }
}
