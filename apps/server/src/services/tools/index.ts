/** 常用工具集：LangChain DynamicStructuredTool + GLM Function Calling 适配。 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { toJsonSchema } from '@langchain/core/utils/json_schema'
import { z } from 'zod'

import { getLocalTimezone } from '../extract/timeParse.js'
import type { ResolveHost } from '../../utils/urlGuard.js'
import { calculate } from './calculator.js'
import { fetchUrlText, getWeather, webSearch, type FetchLike, type SearchRecency } from './web.js'

export interface CommonTool {
  name: string
  description: string
  parameters: object
  /** 执行工具并返回可直接回注给模型的 JSON 文本。 */
  invoke(args: Record<string, unknown>): Promise<string>
}

export interface CommonToolsOptions {
  fetchImpl?: FetchLike
  now?: () => Date
  /** 测试注入：URL 守卫的 DNS 解析 */
  resolve?: ResolveHost
}

const asCommonTool = (tool: DynamicStructuredTool): CommonTool => {
  const schema = toJsonSchema(tool.schema) as Record<string, unknown>
  // GLM 不需要 JSON Schema 的元信息字段。
  const parameters = { ...schema }
  delete parameters.$schema
  return {
    name: tool.name,
    description: tool.description,
    parameters,
    invoke: async (args) => {
      const result = await tool.invoke(args)
      return typeof result === 'string' ? result : JSON.stringify(result)
    },
  }
}

const recencySchema = z
  .enum(['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit'])
  .default('noLimit')
  .describe('时间范围：一天、一周、一月、一年或不限')

export const createCommonTools = (options: CommonToolsOptions = {}): CommonTool[] => {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())

  const search = new DynamicStructuredTool({
    name: 'web_search',
    description: '联网搜索网页，获取最新信息、事实资料与来源链接。需要实时或外部信息时使用。',
    schema: z.object({
      query: z.string().min(1).max(200).describe('具体、简洁的搜索关键词'),
      count: z.number().int().min(1).max(10).default(5).describe('返回条数'),
      recency: recencySchema,
    }),
    func: async ({ query, count, recency }) =>
      JSON.stringify(
        await webSearch({
          query,
          count,
          recency: recency as SearchRecency,
          fetchImpl,
          now: now().getTime(),
        }),
      ),
  })

  const datetime = new DynamicStructuredTool({
    name: 'get_current_datetime',
    description: '获取当前日期、精确时间、星期和时区。回答“现在几点/今天几号”等问题时使用。',
    schema: z.object({
      timezone: z
        .string()
        .min(1)
        .max(64)
        .optional()
        .describe('IANA 时区，如 Asia/Shanghai；不传使用服务器本地时区'),
    }),
    func: async ({ timezone }) => {
      const zone = timezone || getLocalTimezone()
      const date = now()
      const local = new Intl.DateTimeFormat('zh-CN', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'long',
      }).format(date)
      return JSON.stringify({
        iso: date.toISOString(),
        unixMs: date.getTime(),
        timezone: zone,
        local,
      })
    },
  })

  const calculator = new DynamicStructuredTool({
    name: 'calculator',
    description: '安全计算数学算式，支持加减乘除、取余、括号、小数和科学计数法；不要心算复杂算式。',
    schema: z.object({
      expression: z.string().min(1).max(200).describe('例如 (128+72)*1.5/4'),
    }),
    func: async ({ expression }) => JSON.stringify({ expression, result: calculate(expression) }),
  })

  const fetchUrl = new DynamicStructuredTool({
    name: 'fetch_url',
    description: '读取指定公开网页的正文与标题；用户提供 URL 或需要查看搜索结果全文时使用。',
    schema: z.object({
      url: z.string().url().describe('公开 HTTP/HTTPS 网页地址'),
      maxChars: z.number().int().min(500).max(20_000).default(6000).describe('最多返回字符数'),
    }),
    func: async ({ url, maxChars }) =>
      JSON.stringify(await fetchUrlText({ url, maxChars, fetchImpl, resolve: options.resolve })),
  })

  const weather = new DynamicStructuredTool({
    name: 'get_weather',
    description: '查询全球城市的实时天气及未来最多三天的天气预报。',
    schema: z.object({
      location: z.string().min(1).max(100).describe('城市名称，如 北京、Shanghai'),
      days: z.number().int().min(1).max(3).default(1).describe('包含今天在内的预报天数'),
    }),
    func: async ({ location, days }) =>
      JSON.stringify(await getWeather({ location, days, fetchImpl })),
  })

  const news = new DynamicStructuredTool({
    name: 'get_news',
    description: '查询某个主题近期的新闻与公开报道，返回标题、链接、摘要和可用的日期。',
    schema: z.object({
      topic: z.string().min(1).max(100).describe('新闻主题；查综合新闻可填“今日要闻”'),
      count: z.number().int().min(1).max(10).default(5).describe('返回条数'),
      recency: z
        .enum(['oneDay', 'oneWeek', 'oneMonth'])
        .default('oneWeek')
        .describe('新闻时间范围'),
    }),
    func: async ({ topic, count, recency }) =>
      JSON.stringify(
        await webSearch({ query: topic, count, recency, fetchImpl, now: now().getTime() }),
      ),
  })

  return [search, datetime, calculator, fetchUrl, weather, news].map(asCommonTool)
}

export const toFunctionToolDefinitions = (tools: CommonTool[]) =>
  tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
