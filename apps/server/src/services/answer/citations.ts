/**
 * 结构化引用 — spec 4.7.3 / 4.8
 *
 * 引用与上下文注入共用同一套编号（模型在回答里用 [n] 标注）。
 * 返回给前端的同时也原样写入 messages.citations 做快照，
 * 条目后续被修改也不影响历史回答对账。
 */

import type { EntryType } from '../extract/extractor.js'
import type { SearchSummary } from '../search/merge.js'
import type { AssembledContext } from './context.js'
import { TYPE_LABEL } from './context.js'

const SNIPPET_MAX = 120

export interface EntryCitation {
  num: number
  type: 'entry'
  /** 条目 id；重复事件展开实例同 id，用 startAt 区分 */
  id: string
  entryType: EntryType
  label: string
  snippet: string
  startAt: number | null
  endAt: number | null
  occurrence: boolean
}

export interface ChunkCitation {
  num: number
  type: 'chunk'
  id: string
  docId: string
  docName: string
  chunkIndex: number
  snippet: string
}

/** 汇总行也计入引用列表（4.6.2），前端可点击展开完整列表 */
export interface SummaryCitation {
  num: number
  type: 'summary'
  text: string
  remaining: number
  byType: Partial<Record<EntryType, number>>
  docChunks: number
}

export type Citation = EntryCitation | ChunkCitation | SummaryCitation

const snippet = (text: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > SNIPPET_MAX ? `${clean.slice(0, SNIPPET_MAX - 1)}…` : clean
}

export const buildCitations = (
  assembled: AssembledContext,
  summary: SearchSummary | null,
  docNames: Map<string, string>,
): Citation[] => {
  const citations: Citation[] = []

  for (const { num, item } of assembled.numbered) {
    if (item.kind === 'entry') {
      citations.push({
        num,
        type: 'entry',
        id: item.entryId ?? item.key,
        entryType: item.type ?? 'note',
        label: item.title,
        snippet: snippet(item.content) || TYPE_LABEL[item.type ?? 'note'],
        startAt: item.startAt,
        endAt: item.endAt,
        occurrence: item.occurrence,
      })
    } else {
      citations.push({
        num,
        type: 'chunk',
        id: item.chunkId ?? item.key,
        docId: item.docId ?? '',
        docName: (item.docId && docNames.get(item.docId)) || '未命名文档',
        chunkIndex: item.chunkIndex ?? 0,
        snippet: snippet(item.content),
      })
    }
  }

  if (summary && assembled.summaryNum !== null) {
    citations.push({
      num: assembled.summaryNum,
      type: 'summary',
      text: summary.text,
      remaining: summary.remaining,
      byType: summary.byType,
      docChunks: summary.docChunks,
    })
  }

  return citations
}
