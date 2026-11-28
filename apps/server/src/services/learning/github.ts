/**
 * GitHub 仓库检索客户端
 *
 * 只使用公开 Search API，不依赖 OAuth：
 *   - 配置 GITHUB_TOKEN 时走认证额度（5000 次/小时）
 *   - 未配置时走匿名额度（10 次/分钟，按服务器出口 IP 全站共享）
 *
 * 超时与限流是「可预期的业务状态」，这里不抛 500，而是返回结构化结果，
 * 由路由层翻译成给用户的专用提示（当前不做 Gitee 兜底）。
 */

const API_BASE = 'https://api.github.com'
const DEFAULT_TIMEOUT_MS = 5_000

export type RepoSort = 'stars' | 'updated' | 'best-match'

export interface RepoItem {
  id: number
  name: string
  fullName: string
  owner: string
  ownerAvatar: string
  description: string
  url: string
  stars: number
  forks: number
  language: string | null
  topics: string[]
  updatedAt: string
}

export type GithubSearchOutcome =
  | { ok: true; items: RepoItem[]; total: number }
  | { ok: false; reason: 'timeout' | 'rate_limited' | 'error'; message: string }

interface RawRepo {
  id: number
  name: string
  full_name: string
  html_url: string
  description: string | null
  stargazers_count: number
  forks_count: number
  language: string | null
  topics?: string[]
  updated_at: string
  owner?: { login?: string; avatar_url?: string }
}

interface RawSearchResponse {
  total_count: number
  items: RawRepo[]
}

/** 单次请求超时：可用 GITHUB_TIMEOUT_MS 覆盖，最小 1s */
const timeoutMs = (): number => {
  const parsed = Number.parseInt(process.env.GITHUB_TIMEOUT_MS || '', 10)
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : DEFAULT_TIMEOUT_MS
}

const toItem = (repo: RawRepo): RepoItem => ({
  id: repo.id,
  name: repo.name,
  fullName: repo.full_name,
  owner: repo.owner?.login ?? repo.full_name.split('/')[0] ?? '',
  ownerAvatar: repo.owner?.avatar_url ?? '',
  description: repo.description ?? '',
  url: repo.html_url,
  stars: repo.stargazers_count,
  forks: repo.forks_count,
  language: repo.language,
  topics: repo.topics ?? [],
  updatedAt: repo.updated_at,
})

/** 是否为超时/中断类错误（fetch 在不同运行时抛不同 name） */
const isTimeoutError = (err: unknown): boolean => {
  const name = (err as Error | undefined)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

export const searchRepos = async (params: {
  q: string
  sort: RepoSort
  limit: number
  /** 分页页码，从 1 开始 */
  page?: number
}): Promise<GithubSearchOutcome> => {
  const { q, sort, limit, page = 1 } = params
  const url = new URL(`${API_BASE}/search/repositories`)
  url.searchParams.set('q', q)
  url.searchParams.set('per_page', String(limit))
  if (page > 1) url.searchParams.set('page', String(page))
  if (sort === 'stars') {
    url.searchParams.set('sort', 'stars')
    url.searchParams.set('order', 'desc')
  } else if (sort === 'updated') {
    url.searchParams.set('sort', 'updated')
    url.searchParams.set('order', 'desc')
  }
  // best-match 不传 sort，交给 GitHub 默认相关性排序

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ai-study-learning',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  let response: Response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs()) })
  } catch (err) {
    if (isTimeoutError(err)) {
      return { ok: false, reason: 'timeout', message: `GitHub 在 ${timeoutMs()}ms 内没有响应` }
    }
    return { ok: false, reason: 'error', message: (err as Error).message }
  }

  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    const message =
      remaining === '0'
        ? 'GitHub 匿名搜索额度已用尽（每分钟 10 次），请稍后再试'
        : `GitHub 拒绝了本次请求（HTTP ${response.status}）`
    return { ok: false, reason: 'rate_limited', message }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: 'error',
      message: `GitHub 返回 HTTP ${response.status}`,
    }
  }

  const data = (await response.json()) as RawSearchResponse
  return {
    ok: true,
    items: (data.items ?? []).map(toItem),
    total: data.total_count ?? 0,
  }
}
