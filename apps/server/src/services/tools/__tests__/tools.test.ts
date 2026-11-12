import { afterEach, describe, expect, it, vi } from 'vitest'

import { calculate } from '../calculator.js'
import { createCommonTools } from '../index.js'
import {
  fetchUrlText,
  getWeather,
  htmlToText,
  parseRssResults,
  validatePublicHttpUrl,
  webSearch,
} from '../web.js'

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>人工智能 &amp; 新进展</title><link>https://example.com/a</link><description>第一条 &lt;b&gt;摘要&lt;/b&gt;</description><pubDate>Thu, 12 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>旧消息</title><link>https://old.example.com/b</link><description><![CDATA[旧摘要]]></description><pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`

const mockFetch = (body: string, contentType = 'text/xml'): typeof fetch =>
  vi.fn(
    async () => new Response(body, { status: 200, headers: { 'content-type': contentType } }),
  ) as unknown as typeof fetch

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('calculate', () => {
  it('按运算优先级计算并处理中文符号与浮点尾差', () => {
    expect(calculate('(128 + 72) × 1.5 ÷ 4')).toBe(75)
    expect(calculate('0.1 + 0.2')).toBe(0.3)
    expect(calculate('-(3 + 2) * 4')).toBe(-20)
    expect(calculate('10 % 3')).toBe(1)
  })

  it('拒绝除零、非法表达式和代码注入', () => {
    expect(() => calculate('1 / 0')).toThrow('除数不能为 0')
    expect(() => calculate('1 +')).toThrow()
    expect(() => calculate('process.exit(1)')).toThrow()
  })
})

describe('搜索与新闻', () => {
  it('解析 RSS 标题、链接、摘要和日期', () => {
    const results = parseRssResults(RSS)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      title: '人工智能 & 新进展',
      url: 'https://example.com/a',
      snippet: '第一条 摘要',
      source: 'example.com',
    })
    expect(results[1].snippet).toBe('旧摘要')
  })

  it('web_search 应用时间过滤与条数限制', async () => {
    const outcome = await webSearch({
      query: '人工智能',
      count: 5,
      recency: 'oneWeek',
      provider: 'bing',
      now: Date.parse('2026-11-13T00:00:00Z'),
      fetchImpl: mockFetch(RSS),
    })
    expect(outcome.provider).toBe('bing-rss')
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].title).toContain('人工智能')
  })

  it('get_news 复用搜索并保留主题', async () => {
    vi.stubEnv('SEARCH_PROVIDER', 'bing')
    const tools = createCommonTools({
      fetchImpl: mockFetch(RSS),
      now: () => new Date('2026-11-13T00:00:00Z'),
    })
    const news = tools.find((tool) => tool.name === 'get_news')
    const output = JSON.parse(
      await news!.invoke({ topic: '人工智能', count: 2, recency: 'oneMonth' }),
    ) as {
      query: string
      results: unknown[]
    }
    expect(output.query).toBe('人工智能')
    expect(output.results).toHaveLength(2)
  })
})

describe('时间与工具注册', () => {
  it('注册六个 LangChain 工具并生成 GLM JSON Schema', () => {
    const tools = createCommonTools()
    expect(tools.map((tool) => tool.name)).toEqual([
      'web_search',
      'get_current_datetime',
      'calculator',
      'fetch_url',
      'get_weather',
      'get_news',
    ])
    for (const tool of tools) {
      expect(tool.parameters).not.toHaveProperty('$schema')
      expect(tool.parameters).toHaveProperty('type', 'object')
    }
  })

  it('get_current_datetime 使用注入时钟和指定时区', async () => {
    const tools = createCommonTools({ now: () => new Date('2026-11-13T02:00:00Z') })
    const datetime = tools.find((tool) => tool.name === 'get_current_datetime')
    const output = JSON.parse(await datetime!.invoke({ timezone: 'Asia/Shanghai' })) as {
      local: string
      iso: string
    }
    expect(output.iso).toBe('2026-11-13T02:00:00.000Z')
    expect(output.local).toContain('2026')
    expect(output.local).toContain('星期五')
    expect(output.local).toContain('10')
  })

  it('calculator 工具返回结构化结果', async () => {
    const tools = createCommonTools()
    const calculator = tools.find((tool) => tool.name === 'calculator')
    expect(JSON.parse(await calculator!.invoke({ expression: '6 * 7' }))).toEqual({
      expression: '6 * 7',
      result: 42,
    })
  })
})

describe('天气', () => {
  it('映射当前天气和预报字段', async () => {
    const body = JSON.stringify({
      current_condition: [
        {
          temp_C: '5',
          FeelsLikeC: '2',
          humidity: '70',
          windspeedKmph: '4',
          weatherDesc: [{ value: 'Smoky haze' }],
        },
      ],
      nearest_area: [{ areaName: [{ value: 'Beijing' }], country: [{ value: 'China' }] }],
      weather: [
        {
          date: '2026-11-13',
          mintempC: '1',
          maxtempC: '10',
          hourly: [{ weatherDesc: [{ value: 'Sunny' }] }],
        },
      ],
    })
    const result = await getWeather({
      location: '北京',
      days: 1,
      fetchImpl: mockFetch(body, 'application/json'),
    })
    expect(result.location).toBe('Beijing，China')
    expect(result.current).toMatchObject({ temperatureC: '5', humidityPct: '70' })
    expect(result.forecast[0]).toMatchObject({ maxTemperatureC: '10', description: 'Sunny' })
  })
})

describe('网页读取', () => {
  it('清理脚本和标签并限制正文长度', async () => {
    const html = `<!doctype html><html><head><title>示例 &amp; 网页</title><style>x</style></head>
      <body><script>alert(1)</script><h1>标题</h1><p>第一段</p><p>第二段</p></body></html>`
    const result = await fetchUrlText({
      url: 'https://example.com/article',
      maxChars: 500,
      fetchImpl: mockFetch(html, 'text/html; charset=utf-8'),
    })
    expect(result.title).toBe('示例 & 网页')
    expect(result.content).toContain('第一段')
    expect(result.content).not.toContain('alert')
    expect(htmlToText(html).content).not.toContain('<p>')
  })

  it('拦截本机、内网和非 HTTP 地址', () => {
    expect(() => validatePublicHttpUrl('http://localhost:3001')).toThrow('内网')
    expect(() => validatePublicHttpUrl('http://192.168.1.2')).toThrow('内网')
    expect(() => validatePublicHttpUrl('file:///etc/passwd')).toThrow('HTTP/HTTPS')
    expect(validatePublicHttpUrl('https://example.com').hostname).toBe('example.com')
  })
})
