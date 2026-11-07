/**
 * 三路结果合并与排序 — spec 4.5.3 / 4.5.4
 *
 * 权重：时间通道日程 1.3 > 语义条目 1.0 > 语义文档块 0.8
 * 每个通道先按通道内最高分归一化，避免 RRF 的微小数值让时间通道天然压制语义通道。
 * 输出上限 15 条（条目 ≤10、文档块 ≤5），其余按类型汇总为一行。
 */

import type { EntryType } from '../extract/extractor.js'
import type { DocChannelHit } from './docChannel.js'
import type { EntrySearchHit } from './entrySearch.js'
import type { TimeChannelHit } from './timeChannel.js'

export const TIME_WEIGHT = 1.3
export const ENTRY_WEIGHT = 1.0
export const DOC_WEIGHT = 0.8

export const MAX_ENTRY_RESULTS = 10
export const MAX_DOC_RESULTS = 5
export const MAX_TOTAL_RESULTS = MAX_ENTRY_RESULTS + MAX_DOC_RESULTS

const TYPE_LABEL: Record<EntryType, string> = {
  schedule: '日程',
  plan: '规划',
  fact: '事实',
  note: '笔记',
}

export type SearchSource = 'time' | 'semantic'

export interface SearchResultItem {
  /** 唯一定位：entry:<id>:<实例开始> 或 chunk:<docId>:<chunkIndex> */
  key: string
  kind: 'entry' | 'chunk'
  source: SearchSource
  entryId?: string
  docId?: string
  chunkId?: string
  chunkIndex?: number
  type?: EntryType
  title: string
  content: string
  startAt: number | null
  endAt: number | null
  occurrence: boolean
  /** 加权后的最终分 */
  score: number
  /** 通道内归一化分（0-1） */
  channelScore: number
  vectorScore?: number
  bm25Score?: number
}

export interface SearchSummary {
  total: number
  shown: number
  remaining: number
  text: string
  byType: Partial<Record<EntryType, number>>
  docChunks: number
}

export interface MergeInput {
  timeHits: TimeChannelHit[]
  entryHits: EntrySearchHit[]
  docHits: DocChannelHit[]
}

export interface MergeOutput {
  results: SearchResultItem[]
  summary: SearchSummary | null
}

interface RawItem {
  item: SearchResultItem
  weight: number
}

const uniqueKey = (entryId: string, startAt: number | null, occurrence: boolean): string =>
  occurrence && startAt !== null ? `entry:${entryId}:${startAt}` : `entry:${entryId}`

/** 同一文档相邻块合并展示，只保留一次引用（spec 4.5.4） */
const mergeAdjacentChunks = (hits: DocChannelHit[]): DocChannelHit[] => {
  const byDoc = new Map<string, DocChannelHit[]>()
  for (const hit of hits) {
    const list = byDoc.get(hit.docId) ?? []
    list.push(hit)
    byDoc.set(hit.docId, list)
  }

  const merged: DocChannelHit[] = []
  for (const list of byDoc.values()) {
    list.sort((a, b) => a.chunkIndex - b.chunkIndex)
    let current: DocChannelHit | null = null
    for (const hit of list) {
      if (current && hit.chunkIndex - current.chunkIndex === 1) {
        const prev: DocChannelHit = current
        current = {
          ...prev,
          content: `${prev.content}\n${hit.content}`,
          score: Math.max(prev.score, hit.score),
          vectorScore: Math.max(prev.vectorScore ?? 0, hit.vectorScore ?? 0) || undefined,
          bm25Score: Math.max(prev.bm25Score ?? 0, hit.bm25Score ?? 0) || undefined,
        }
        continue
      }
      if (current) merged.push(current)
      current = { ...hit }
    }
    if (current) merged.push(current)
  }
  return merged
}

const normalize = (raw: RawItem[]): RawItem[] => {
  const maxByGroup = new Map<string, number>()
  for (const { item } of raw) {
    const group = `${item.source}:${item.kind}`
    maxByGroup.set(group, Math.max(maxByGroup.get(group) ?? 0, item.score))
  }
  return raw.map((entry) => {
    const group = `${entry.item.source}:${entry.item.kind}`
    const max = maxByGroup.get(group) ?? 0
    const channelScore = max > 0 ? entry.item.score / max : 0
    return {
      weight: entry.weight,
      item: { ...entry.item, channelScore, score: channelScore * entry.weight },
    }
  })
}

const buildSummaryText = (summary: Omit<SearchSummary, 'text'>): string => {
  const parts: string[] = []
  for (const [type, count] of Object.entries(summary.byType)) {
    if (count > 0) parts.push(`${count} 条${TYPE_LABEL[type as EntryType]}`)
  }
  if (summary.docChunks > 0) parts.push(`${summary.docChunks} 条文档片段`)
  return `另有 ${summary.remaining} 条相关记录（${parts.join('、')}），已合并`
}

/** DB 列类型是 TEXT，逻辑上收敛到四类 */
const asEntryType = (value: string): EntryType => value as EntryType

export const mergeSearchSignals = (input: MergeInput): MergeOutput => {
  const raw: RawItem[] = []
  const entryTimeIndex = new Set<string>()

  for (const hit of input.timeHits) {
    entryTimeIndex.add(hit.entry.id)
    raw.push({
      weight: TIME_WEIGHT,
      item: {
        key: uniqueKey(hit.entry.id, hit.startAt, hit.occurrence),
        kind: 'entry',
        source: 'time',
        entryId: hit.entry.id,
        type: asEntryType(hit.entry.type),
        title: hit.entry.title,
        content: hit.entry.content,
        startAt: hit.startAt,
        endAt: hit.endAt,
        occurrence: hit.occurrence,
        score: hit.score,
        channelScore: 0,
      },
    })
  }

  for (const hit of input.entryHits) {
    // 同一条目已在时间通道命中：时间更确定，保留时间实例，不再重复
    if (entryTimeIndex.has(hit.entry.id)) continue
    raw.push({
      weight: ENTRY_WEIGHT,
      item: {
        key: uniqueKey(hit.entry.id, null, false),
        kind: 'entry',
        source: 'semantic',
        entryId: hit.entry.id,
        type: asEntryType(hit.entry.type),
        title: hit.entry.title,
        content: hit.entry.content,
        startAt: hit.entry.startAt ? hit.entry.startAt.getTime() : null,
        endAt: hit.entry.endAt ? hit.entry.endAt.getTime() : null,
        occurrence: false,
        score: hit.score,
        channelScore: 0,
        vectorScore: hit.vectorScore,
        bm25Score: hit.bm25Score,
      },
    })
  }

  for (const hit of mergeAdjacentChunks(input.docHits)) {
    raw.push({
      weight: DOC_WEIGHT,
      item: {
        key: `chunk:${hit.docId}:${hit.chunkIndex}`,
        kind: 'chunk',
        source: 'semantic',
        docId: hit.docId,
        chunkId: hit.chunkId,
        chunkIndex: hit.chunkIndex,
        title: '',
        content: hit.content,
        startAt: null,
        endAt: null,
        occurrence: false,
        score: hit.score,
        channelScore: 0,
        vectorScore: hit.vectorScore,
        bm25Score: hit.bm25Score,
      },
    })
  }

  const sorted = normalize(raw).sort((a, b) => {
    if (b.item.score !== a.item.score) return b.item.score - a.item.score
    if (a.item.source !== b.item.source) return a.item.source === 'time' ? -1 : 1
    return (a.item.startAt ?? 0) - (b.item.startAt ?? 0)
  })

  const results: SearchResultItem[] = []
  let entryCount = 0
  let docCount = 0
  const byType: Partial<Record<EntryType, number>> = {}
  let docChunks = 0
  let remaining = 0

  for (const { item } of sorted) {
    const withinTotal = results.length < MAX_TOTAL_RESULTS
    const withinKind =
      item.kind === 'entry' ? entryCount < MAX_ENTRY_RESULTS : docCount < MAX_DOC_RESULTS

    if (withinTotal && withinKind) {
      results.push(item)
      if (item.kind === 'entry') entryCount++
      else docCount++
      continue
    }

    remaining++
    if (item.kind === 'chunk') {
      docChunks++
    } else if (item.type) {
      byType[item.type] = (byType[item.type] ?? 0) + 1
    }
  }

  const summary: SearchSummary | null =
    remaining > 0
      ? {
          total: sorted.length,
          shown: results.length,
          remaining,
          byType,
          docChunks,
          text: buildSummaryText({
            total: sorted.length,
            shown: results.length,
            remaining,
            byType,
            docChunks,
          }),
        }
      : null

  return { results, summary }
}
