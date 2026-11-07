/**
 * 上下文组装 — spec 4.6
 *
 * 检索结果 → 带编号的注入文本。编号即引用编号，生成与 citations 共用同一套序号。
 *
 * 预算（4.6.1）：条目单条 ≤120 token、文档块 ≤300 token、15 条合计 ≤2400 token。
 * 没有 tokenizer，按中文 1 token ≈ 1.3 字符折算为字符上限（160 / 400 / 3200）。
 * 截断按 merge 排好的优先级顺序（时间通道 > 语义条目 > 文档块），超预算的低优先级
 * 条目不注入、不编号，也不出现在引用里。
 */

import { formatClock, formatDate, formatDateTime } from '../extract/timeParse.js'
import type { EntryType } from '../extract/extractor.js'
import { MAX_TOTAL_RESULTS, type SearchResultItem, type SearchSummary } from '../search/merge.js'

const ENTRY_LINE_MAX = 160
const CHUNK_LINE_MAX = 400
const TOTAL_MAX = 3200

export const TYPE_LABEL: Record<EntryType, string> = {
  schedule: '日程',
  plan: '规划',
  fact: '事实',
  note: '笔记',
}

export interface NumberedItem {
  num: number
  item: SearchResultItem
}

export interface AssembledContext {
  /** 注入 user 消息的上下文文本；无记录时为空串（4.6.3：不注入空标题） */
  text: string
  numbered: NumberedItem[]
  /** 汇总行编号（存在时 = MAX_TOTAL_RESULTS + 1），无汇总为 null */
  summaryNum: number | null
}

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/** 条目行：1. [日程] 2026-11-11 周三 14:00 提交 v5 方案（录入于 2026-11-06） */
const entryLine = (num: number, item: SearchResultItem, timezone: string): string => {
  const label = TYPE_LABEL[item.type ?? 'note']
  const parts: string[] = []

  if (item.startAt !== null) {
    const start = formatDateTime(item.startAt, timezone)
    const sameDay =
      item.endAt !== null && formatDate(item.startAt, timezone) === formatDate(item.endAt, timezone)
    const time =
      item.endAt !== null && sameDay ? `${start}-${formatClock(item.endAt, timezone)}` : start
    parts.push(time)
  }

  parts.push(item.title)

  const content = item.content.trim()
  if (content && content !== item.title.trim()) parts.push(content)

  let line = `${num}. [${label}] ${parts.join(' ')}`
  if (item.createdAt !== null) line += `（录入于 ${formatDate(item.createdAt, timezone)}）`
  return truncate(line, ENTRY_LINE_MAX)
}

/** 文档块行：4. 《项目笔记》构建流程使用 Vite…… */
const chunkLine = (num: number, item: SearchResultItem, docNames: Map<string, string>): string => {
  const docName = (item.docId && docNames.get(item.docId)) || '未命名文档'
  const content = item.content.replace(/\s+/g, ' ').trim()
  return truncate(`${num}. 《${docName}》${content}`, CHUNK_LINE_MAX)
}

export const assembleContext = (params: {
  results: SearchResultItem[]
  summary: SearchSummary | null
  docNames: Map<string, string>
  timezone: string
}): AssembledContext => {
  const { results, summary, docNames, timezone } = params

  const entryLines: string[] = []
  const chunkLines: string[] = []
  const numbered: NumberedItem[] = []
  let used = 0

  for (const item of results) {
    const num = numbered.length + 1
    const line =
      item.kind === 'entry' ? entryLine(num, item, timezone) : chunkLine(num, item, docNames)
    if (used + line.length > TOTAL_MAX) break
    used += line.length
    numbered.push({ num, item })
    if (item.kind === 'entry') entryLines.push(line)
    else chunkLines.push(line)
  }

  const sections: string[] = []
  if (entryLines.length > 0) sections.push(`[个人记录]\n${entryLines.join('\n')}`)
  if (chunkLines.length > 0) sections.push(`[资料片段]\n${chunkLines.join('\n')}`)

  let summaryNum: number | null = null
  if (summary && numbered.length > 0) {
    // 汇总行固定编号 16（4.6.2），即使截断导致详细条数不足 15 也保持编号语义稳定
    summaryNum = MAX_TOTAL_RESULTS + 1
    sections.push(`[其他相关]\n${summaryNum}. ${summary.text}`)
  }

  return { text: sections.join('\n\n'), numbered, summaryNum }
}
