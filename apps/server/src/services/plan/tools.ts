/**
 * 规划链路专用工具：只在长期规划生成时注入，避免与对话检索重复。
 *
 * `search_knowledge` 调用统一检索入口 searchAll，把命中的条目/文档片段整理成
 * 精简 JSON 回注给模型，同时通过 `onSources` 回调把结构化来源交给规划图。
 */

import { createCommonTools, type CommonTool } from '../tools/index.js'
import { searchAll } from '../search/searchAll.js'
import type { SearchResultItem } from '../search/merge.js'
import type { PlanSource } from '../plans/store.js'

const MAX_ENTRY_SOURCES = 5
const MAX_DOC_SOURCES = 3
const SNIPPET_CHARS = 200

const toSnippet = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS)

const toSource = (item: SearchResultItem): PlanSource => ({
  type: item.kind === 'entry' ? 'entry' : 'chunk',
  id: item.kind === 'entry' ? (item.entryId ?? item.key) : (item.chunkId ?? item.key),
  label: `${item.kind === 'entry' ? (item.type ?? 'entry') : '文档'} · ${item.title}`.slice(0, 60),
  snippet: toSnippet(item.content),
})

export interface PlanToolOptions {
  libraryId: string
  /** 把检索命中的来源收集给规划图（用于草稿的 sources/grounded） */
  onSources?: (sources: PlanSource[]) => void
  now?: number
  timezone?: string
}

const searchKnowledge = (options: PlanToolOptions): CommonTool => ({
  name: 'search_knowledge',
  description:
    '检索个人知识库（已有记录与上传文档），了解与规划目标相关的个人情况。需要个人事实时使用；可换关键词多轮检索。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索关键词，具体、简洁' },
      scope: {
        type: 'string',
        enum: ['entries', 'documents', 'all'],
        description: '检索范围：个人条目、文档片段或全部',
      },
    },
    required: ['query'],
  },
  invoke: async (args) => {
    const query = String(args.query ?? '').trim()
    const scope = (args.scope as 'entries' | 'documents' | 'all' | undefined) ?? 'all'
    if (!query) return JSON.stringify({ error: 'query 不能为空' })

    const result = await searchAll({
      query,
      libraryId: options.libraryId,
      now: options.now,
      timezone: options.timezone,
      skipUnderstanding: true,
    })

    const inScope = result.results.filter((item) =>
      scope === 'all' ? true : scope === 'entries' ? item.kind === 'entry' : item.kind === 'chunk',
    )
    const entries = inScope.filter((item) => item.kind === 'entry').slice(0, MAX_ENTRY_SOURCES)
    const docs = inScope.filter((item) => item.kind === 'chunk').slice(0, MAX_DOC_SOURCES)
    const picked = [...entries, ...docs]
    const sources = picked.map(toSource)
    if (sources.length > 0) options.onSources?.(sources)

    return JSON.stringify({
      query,
      scope,
      count: sources.length,
      matches: sources.map((source) => ({
        id: source.id,
        type: source.type,
        title: source.label,
        snippet: source.snippet,
      })),
      ...(sources.length === 0 ? { note: '知识库未检索到相关内容' } : {}),
    })
  },
})

/** 规划调研工具集：知识库检索 + 当前时间（复用公共工具，避免重复实现） */
export const createPlanResearchTools = (options: PlanToolOptions): CommonTool[] => {
  const datetime = createCommonTools().filter((tool) => tool.name === 'get_current_datetime')
  return [searchKnowledge(options), ...datetime]
}
