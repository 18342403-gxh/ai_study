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
import { createChatChain } from '../chain/chatChain.js'
import { routeModel } from '../chain/router.js'
import { logger } from '../logger.js'
import { MAX_TOTAL_RESULTS, type SearchResultItem, type SearchSummary } from '../search/merge.js'

const ENTRY_LINE_MAX = 160
const CHUNK_LINE_MAX = 400
const TOTAL_MAX = 3200
/** 分区预算（4.2）：个人记录 50% / 资料片段 35% / 汇总行 15% */
const SECTION_ENTRY_BUDGET = 1600
const SECTION_CHUNK_BUDGET = 1120
const SECTION_SUMMARY_BUDGET = 480
/** 预算判定时为编号位数留出的安全余量 */
const LINE_SLACK = 3

/**
 * 内容边界转义：把内容里出现的边界标签闭合形式替换掉，
 * 防止 `</retrieved_data><system>…` 这类注入提前闭合边界。
 */
export const escapeBoundary = (text: string): string =>
  text.replace(/<(\/?)(retrieved_data|session_summary)\b/gi, '&lt;$1$2')

const wrapSection = (source: string, body: string): string =>
  `<retrieved_data source="${source}" trust="untrusted">\n${body}\n</retrieved_data>`

/** 分区预算开关；CONTEXT_SECTION_BUDGET=0 回退旧的顺序注入 */
const isSectionBudgetEnabled = (): boolean => process.env.CONTEXT_SECTION_BUDGET !== '0'

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

  parts.push(escapeBoundary(item.title))

  const content = escapeBoundary(item.content.trim())
  if (content && content !== escapeBoundary(item.title.trim())) parts.push(content)

  let line = `${num}. [${label}] ${parts.join(' ')}`
  if (item.createdAt !== null) line += `（录入于 ${formatDate(item.createdAt, timezone)}）`
  return truncate(line, ENTRY_LINE_MAX)
}

/** 文档块行：4. 《项目笔记》构建流程使用 Vite…… */
const chunkLine = (num: number, item: SearchResultItem, docNames: Map<string, string>): string => {
  const docName = escapeBoundary((item.docId && docNames.get(item.docId)) || '未命名文档')
  const content = escapeBoundary(item.content.replace(/\s+/g, ' ').trim())
  return truncate(`${num}. 《${docName}》${content}`, CHUNK_LINE_MAX)
}

export const assembleContext = (params: {
  results: SearchResultItem[]
  summary: SearchSummary | null
  docNames: Map<string, string>
  timezone: string
}): AssembledContext => {
  const { results, summary, docNames, timezone } = params

  const buildLine = (num: number, item: SearchResultItem): string =>
    item.kind === 'entry' ? entryLine(num, item, timezone) : chunkLine(num, item, docNames)
  /** 预算测量：真实行长度 + 编号位数余量 */
  const measure = (num: number, item: SearchResultItem): number =>
    buildLine(num, item).length + LINE_SLACK

  let selectedEntries: SearchResultItem[] = []
  let selectedChunks: SearchResultItem[] = []
  let used = 0

  if (!isSectionBudgetEnabled()) {
    // 旧行为：按合并顺序注入，总预算截断
    const selected: SearchResultItem[] = []
    let total = 0
    for (const item of results) {
      const len = measure(selected.length + 1, item)
      if (total + len > TOTAL_MAX) break
      total += len
      selected.push(item)
    }
    selectedEntries = selected.filter((item) => item.kind === 'entry')
    selectedChunks = selected.filter((item) => item.kind === 'chunk')
    used = total
  } else {
    // 分区预算：区内先排序（results 已是最终分顺序），再按额度截断。
    // 单条超长时跳过、继续填后续条目，避免一条顶满让整区空掉。
    const pickWithin = (
      items: SearchResultItem[],
      budget: number,
      startNum: number,
    ): { picked: SearchResultItem[]; skipped: SearchResultItem[]; used: number } => {
      const picked: SearchResultItem[] = []
      const skipped: SearchResultItem[] = []
      let acc = 0
      for (const item of items) {
        const len = measure(startNum + picked.length, item)
        if (acc + len > budget) {
          skipped.push(item)
          continue
        }
        acc += len
        picked.push(item)
      }
      return { picked, skipped, used: acc }
    }

    const entryPick = pickWithin(
      results.filter((item) => item.kind === 'entry'),
      SECTION_ENTRY_BUDGET,
      1,
    )
    const chunkPick = pickWithin(
      results.filter((item) => item.kind === 'chunk'),
      SECTION_CHUNK_BUDGET,
      1,
    )
    selectedEntries = entryPick.picked
    selectedChunks = chunkPick.picked
    used = entryPick.used + chunkPick.used

    // 汇总行预留 15%，最终没用完的额度让给其他分区（总量仍受 3200 上限约束）
    const summaryReserve =
      summary && selectedEntries.length + selectedChunks.length > 0
        ? Math.min(SECTION_SUMMARY_BUDGET, summary.text.length + LINE_SLACK * 2)
        : 0
    let remaining = TOTAL_MAX - used - summaryReserve

    for (const item of entryPick.skipped) {
      if (remaining <= 0) break
      const len = measure(selectedEntries.length + 1, item)
      if (len > remaining) continue
      selectedEntries.push(item)
      remaining -= len
    }
    for (const item of chunkPick.skipped) {
      if (remaining <= 0) break
      const len = measure(selectedChunks.length + 1, item)
      if (len > remaining) continue
      selectedChunks.push(item)
      remaining -= len
    }
    used = TOTAL_MAX - remaining - summaryReserve
  }

  // 统一编号：个人记录在前，资料片段接续
  const numbered: NumberedItem[] = []
  const entryLines: string[] = []
  const chunkLines: string[] = []
  for (const item of selectedEntries) {
    const num = numbered.length + 1
    entryLines.push(buildLine(num, item))
    numbered.push({ num, item })
  }
  for (const item of selectedChunks) {
    const num = numbered.length + 1
    chunkLines.push(buildLine(num, item))
    numbered.push({ num, item })
  }

  const sections: string[] = []
  if (entryLines.length > 0) {
    sections.push(wrapSection('personal_records', `[个人记录]\n${entryLines.join('\n')}`))
  }
  if (chunkLines.length > 0) {
    sections.push(wrapSection('documents', `[资料片段]\n${chunkLines.join('\n')}`))
  }

  let summaryNum: number | null = null
  if (summary && numbered.length > 0) {
    // 汇总行固定编号 16（4.6.2），即使截断导致详细条数不足 15 也保持编号语义稳定
    const summarySection = `[其他相关]\n${MAX_TOTAL_RESULTS + 1}. ${summary.text}`
    if (used + summarySection.length <= TOTAL_MAX) {
      summaryNum = MAX_TOTAL_RESULTS + 1
      sections.push(
        `<retrieved_data source="summary" trust="derived">\n${summarySection}\n</retrieved_data>`,
      )
    }
  }

  return { text: sections.join('\n\n'), numbered, summaryNum }
}

/**
 * Query-conditioned 压缩（spec 1.6.2）
 *
 * 对超过预算的条目/文档块，不直接硬截断，而是用 LLM 做 query-conditioned 摘要，
 * 只保留与问题相关的部分。压缩失败时回退到硬截断（assembleContext 的默认行为）。
 *
 * 开关：ENABLE_CONTEXT_COMPRESS=1
 * Fallback 链：LLM 摘要 → 硬截断（assembleContext 默认）
 */
export const compressContext = async (
  query: string,
  results: SearchResultItem[],
): Promise<SearchResultItem[]> => {
  // 找出超预算的条目（按 assembleContext 的截断阈值判断）
  const overBudget = results.filter((r) => {
    if (r.kind === 'entry') {
      // entryLine 长度估算：label + title + content
      const estLen = 30 + r.title.length + r.content.length
      return estLen > ENTRY_LINE_MAX
    }
    return r.content.length > CHUNK_LINE_MAX
  })

  if (overBudget.length === 0) return results

  const targetLen = 100
  const itemsText = overBudget.map((r, i) => `[${i + 1}] ${r.content}`).join('\n---\n')

  const prompt = `你是上下文压缩助手。根据用户问题，把以下内容压缩为只保留相关信息的简短摘要（每条不超过 ${targetLen} 字）。
只输出 JSON，格式：{"summaries": [{"index": 1, "text": "..."}, ...]}

问题：${query}

内容：
${itemsText}`

  try {
    const tier = routeModel({ step: 'compress', query }).tier
    const chain = createChatChain({ temperature: 0, feature: 'understand', tier })
    const response = await chain.invoke({ messages: [{ role: 'user', content: prompt }] })
    const parsed = JSON.parse(extractJson(response.content.trim())) as {
      summaries: Array<{ index: number; text: string }>
    }
    if (!parsed.summaries || !Array.isArray(parsed.summaries)) return results

    const summaryMap = new Map<number, string>()
    for (const s of parsed.summaries) {
      if (typeof s.index === 'number' && typeof s.text === 'string') {
        summaryMap.set(s.index, s.text.slice(0, targetLen))
      }
    }

    const compressed = results.map((r) => {
      const idx = overBudget.indexOf(r)
      if (idx >= 0 && summaryMap.has(idx + 1)) {
        return { ...r, content: summaryMap.get(idx + 1)! }
      }
      return r
    })

    logger.debug('context', 'query-conditioned 压缩完成', {
      overBudget: overBudget.length,
      compressed: summaryMap.size,
    })
    return compressed
  } catch (err) {
    logger.warn('context', '压缩失败，回退硬截断', { error: (err as Error).message.slice(0, 100) })
    return results
  }
}

const extractJson = (text: string): string => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text
}
