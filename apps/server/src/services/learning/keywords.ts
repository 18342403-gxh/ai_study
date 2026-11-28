/**
 * 学习页的检索意图解析
 *
 * 用户用自然语言描述想要的项目（“帮我找 Vue3 的后台管理模板，要带权限”），
 * 这里把它解析成 GitHub Search 能吃的结构化条件：
 *   - keywords：搜索词
 *   - language：GitHub 语言过滤（可选）
 *   - sort：排序偏好
 *
 * 优先用小模型解析；解析失败/超时一律回退到规则实现，保证功能不中断。
 */

import { z } from 'zod'

import { createChatChain } from '../chain/chatChain.js'
import { routeModel } from '../chain/router.js'
import { logger } from '../logger.js'
import type { RepoSort } from './github.js'

export interface ParsedIntent {
  keywords: string[]
  /** 结果太少时用的放宽说法（近义词/更宽泛的检索短语） */
  alternatives: string[]
  language: string | null
  sort: RepoSort
  /** llm = 模型解析；rule = 规则回退 */
  parsedBy: 'llm' | 'rule'
}

const intentSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(6),
  alternatives: z.array(z.string().min(1)).max(3).optional(),
  language: z.string().min(1).max(32).nullable().optional(),
  sort: z.enum(['stars', 'updated', 'best-match']).optional(),
})

/** GitHub 的 q 里空格等于 AND，关键词太多会把结果收窄到 0 */
const MAX_KEYWORDS = 3

/** 「活跃」意图的时间窗（天）；90 天过于苛刻，放宽到半年 */
const RECENT_DAYS = 180

const PARSE_TIMEOUT_MS = 8_000

/** 常见语言/框架的判定规则（仅做保守映射，避免乱加 language 过滤） */
const LANGUAGE_HINTS: Array<[RegExp, string]> = [
  [/\btypescript\b|\bts\b/i, 'TypeScript'],
  [/\bjavascript\b|\bjs\b/i, 'JavaScript'],
  [/\bpython\b/i, 'Python'],
  [/\bjava\b/i, 'Java'],
  [/\bgolang\b|\bgo\s*(语言|项目)?\b/i, 'Go'],
  [/\brust\b/i, 'Rust'],
  [/\bc\+\+\b|\bcpp\b/i, 'C++'],
  [/\bc#\b|\bcsharp\b/i, 'C#'],
  [/\bphp\b/i, 'PHP'],
  [/\bswift\b/i, 'Swift'],
  [/\bkotlin\b/i, 'Kotlin'],
  [/\bdart\b|\bflutter\b/i, 'Dart'],
  [/\bvue\b/i, 'Vue'],
]

/** 中文口语 → 英文技术词的保守映射，用于模型不可用时的规则回退 */
const ZH_HINTS: Array<[RegExp, string[]]> = [
  [/记账|账本|收支|理财|花销/i, ['expense', 'tracker']],
  [/待办|任务清单|清单|打卡/i, ['todo', 'task']],
  [/后台|管理后台|管理系统|仪表盘|admin|dashboard/i, ['admin', 'dashboard']],
  [/商城|电商|购物|秒杀|订单/i, ['ecommerce', 'shop']],
  [/聊天|即时通讯|通讯|消息|chat|im\b/i, ['chat', 'messaging']],
  [/爬虫|抓取|采集|crawl|scrap/i, ['crawler', 'scraper']],
  [/博客|文章|写作/i, ['blog']],
  [/笔记|备忘录|知识库|note/i, ['notes', 'knowledge']],
  [/简历|求职|resume|cv\b/i, ['resume']],
  [/网盘|云盘|文件存储/i, ['cloud', 'storage']],
  [/视频|播放器|video/i, ['video']],
  [/音乐|歌单|music/i, ['music']],
  [/图表|可视化|大屏|chart|visuali/i, ['visualization', 'chart']],
  [/监控|运维|monitor/i, ['monitor', 'observability']],
  [/支付|结算|payment/i, ['payment']],
  [/权限|鉴权|登录|认证|auth|login/i, ['auth']],
  [/搜索|检索|search/i, ['search']],
  [/推荐|算法推荐|recommend/i, ['recommendation']],
  [/面试|题库|interview/i, ['interview']],
  [/算法|数据结构|刷题|algorithm/i, ['algorithm']],
  [/游戏|小游戏|game/i, ['game']],
  [/天气|weather/i, ['weather']],
  [/股票|行情|量化|stock|quant/i, ['stock', 'quant']],
  [/工作流|流程|审批|workflow/i, ['workflow']],
  [/小程序|mini.?program/i, ['miniprogram', 'wechat']],
  [/低代码|无代码|low.?code/i, ['low-code']],
  [/脚手架|模板|样板|starter|template|boilerplate/i, ['starter', 'template']],
  [/组件库|ui\s*库|component/i, ['ui', 'components']],
  [/暗色|深色|主题|theme/i, ['theme']],
  [/桌面|客户端|desktop|electron/i, ['electron', 'desktop']],
  [/跨平台|flutter|react.?native/i, ['flutter']],
]

/** 英文里的泛词，规则回退时不当作关键词 */
const EN_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'app',
  'apps',
  'project',
  'projects',
  'a',
  'an',
  'to',
  'of',
  'in',
  'my',
  'i',
  'want',
  'need',
  'find',
  'some',
  'good',
  'best',
  'like',
  'use',
  'using',
  'please',
  'help',
  'me',
  'can',
  'you',
  'is',
  'are',
  'on',
  'about',
  'make',
  'build',
])

/** 模型也可能吐出的泛词：没有检索价值，会把结果带偏 */
const EN_GENERIC_WORDS = new Set([
  'tool',
  'tools',
  'app',
  'apps',
  'application',
  'system',
  'project',
  'projects',
  'simple',
  'easy',
  'basic',
  'demo',
  'example',
  'code',
  'source',
  'software',
  'platform',
  'website',
  'web',
  'site',
  'stuff',
  'thing',
  'things',
])

/** 中文口语里的填充词，规则回退时剔除 */
const FILLER_RE =
  /我想|想找|想要|帮我|给我|找一个|找一些|找点|有没有|推荐|一些|相关|的|项目|可以|能用|好用的|适合|类似|这种|那种|最好|请问|谢谢|吗|呢|吧/g

const detectLanguage = (text: string): string | null => {
  for (const [re, language] of LANGUAGE_HINTS) {
    if (re.test(text)) return language
  }
  return null
}

const detectSort = (text: string): RepoSort => {
  if (/star|热门|最火|最热|高星/i.test(text)) return 'stars'
  if (/最新|最近更新|活跃/i.test(text)) return 'updated'
  return 'best-match'
}

/** 从口语描述里抽取英文关键词（优先命中中文映射，再补充原文里的英文词） */
const extractEnglishKeywords = (raw: string): string[] => {
  const mapped: string[] = []
  for (const [re, words] of ZH_HINTS) {
    if (re.test(raw)) mapped.push(...words)
  }
  const latin = (raw.match(/[A-Za-z][A-Za-z0-9+.#-]{1,}/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !EN_STOP_WORDS.has(word))
  // 用户明确写出的英文（如 vue3、rust）优先，其次才是中文映射出的领域词
  return [...new Set([...latin, ...mapped])]
}

/** 规则回退：中文术语映射成英文，去掉口语填充词，按标点切分 */
export const ruleParse = (raw: string): ParsedIntent => {
  const cleaned = raw.replace(FILLER_RE, ' ').trim()
  const tokens = cleaned
    .split(/[\s,，。；;、/|+]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)

  // 中文能映射出英文词时只保留英文，避免把中文整句丢给 GitHub 搜索导致 0 结果
  const english = extractEnglishKeywords(raw)
  const keywords = (english.length > 0 ? english : tokens).slice(0, MAX_KEYWORDS)

  return {
    keywords: keywords.length > 0 ? keywords : [raw.trim()],
    alternatives: [],
    language: detectLanguage(raw),
    sort: detectSort(raw),
    parsedBy: 'rule',
  }
}

const stripCodeFence = (text: string): string => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  return (fenced?.[1] ?? text).trim()
}

const withTimeout = async <T>(task: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('parse timeout')), ms)
  })
  try {
    return await Promise.race([task, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const parseWithLlm = async (raw: string): Promise<ParsedIntent> => {
  const tier = routeModel({ step: 'understand', query: raw }).tier
  const chain = createChatChain({ temperature: 0, feature: 'understand', tier })
  const prompt = `你是 GitHub 仓库检索助手。把用户的需求转换成仓库搜索条件。

要求：
1. 先理解用户的真实用途，再选英文技术词。口语化、中文、含错别字的需求都要先归纳出「做什么用的工具」。
   例如「我想找个能记账的小工具」= expense tracker；「有没有那种能管任务清单的」= todo task。
2. keywords 用英文技术词，**2-3 个单个单词**，按重要度排序（如 "vue3 admin dashboard"）。
   每个关键词不要带空格，也不要把多个词拼成一个（错误示例："admin dashboard"、"dark theme"）。
   GitHub 搜索里空格等于 AND，词太多会导致 0 结果，所以只保留最关键的几个。
   中文需求也要翻译成英文关键词；专有名词/框架名保留原样。
   禁止使用 tool/app/system/project/simple/easy/basic/demo 这类泛词，必须用能表达用途的领域词
   （如记账用 expense/budget/finance，而不是 accounting/tool）。
3. alternatives：给 1-2 个更宽泛或近义的英文检索短语（可含空格），用于结果太少时放宽。
   例如 keywords=["expense","tracker"] 时，alternatives=["budget app","personal finance"]。
4. language 只在用户明确提到编程语言时填写（如 TypeScript、Python、Go），否则填 null。
   框架名（Vue、React、Spring）不要当作 language。
5. sort：用户强调 star/热门填 "stars"；强调最新/活跃填 "updated"；否则 "best-match"。
6. 只输出 JSON，不要解释，不要 Markdown 代码块。

输出格式：
{"keywords":["expense","tracker"],"alternatives":["budget app","personal finance"],"language":null,"sort":"best-match"}

用户需求：${raw}`

  const result = await withTimeout(
    chain.invoke({ messages: [{ role: 'user', content: prompt }] }),
    PARSE_TIMEOUT_MS,
  )
  const parsed = intentSchema.parse(JSON.parse(stripCodeFence(result.content)))

  // 模型偶尔会把多个词拼成一个关键词，这里按空格拆开再取前 N 个，保证 q 的 AND 数量可控
  const cleanedKeywords = parsed.keywords
    .flatMap((keyword) => keyword.split(/\s+/))
    .map((keyword) => keyword.trim())
    .filter(Boolean)
  // 丢掉 tool/app/simple 这类泛词；全被过滤掉时保留原值，避免关键词为空
  const specificKeywords = cleanedKeywords.filter(
    (keyword) => !EN_GENERIC_WORDS.has(keyword.toLowerCase()),
  )
  const keywords = (specificKeywords.length > 0 ? specificKeywords : cleanedKeywords).slice(
    0,
    MAX_KEYWORDS,
  )

  const alternatives = (parsed.alternatives ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 2)

  return {
    keywords: keywords.length > 0 ? keywords : ruleParse(raw).keywords,
    alternatives,
    language: parsed.language ?? null,
    sort: parsed.sort ?? 'best-match',
    parsedBy: 'llm',
  }
}

/** 解析用户自然语言需求；模型失败时静默回退到规则解析 */
export const parseSearchIntent = async (raw: string): Promise<ParsedIntent> => {
  try {
    const intent = await parseWithLlm(raw)
    logger.info('learning.parse', '检索意图解析完成', {
      keywords: intent.keywords,
      language: intent.language,
      sort: intent.sort,
    })
    return intent
  } catch (err) {
    logger.warn('learning.parse', '模型解析失败，回退规则解析', {
      error: (err as Error).message.slice(0, 120),
    })
    return ruleParse(raw)
  }
}

/** 拼出 GitHub Search 的 q 参数 */
export const buildGithubQuery = (intent: ParsedIntent): string => {
  const parts = [...intent.keywords]
  if (intent.language) parts.push(`language:${intent.language}`)
  // 「活跃」意图：加 pushed 时间窗，配合下方按 star 排序，避免只剩零星新仓库
  if (intent.sort === 'updated') {
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10)
    parts.push(`pushed:>${since}`)
  }
  return parts.join(' ')
}
