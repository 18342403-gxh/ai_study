/**
 * 抽取链路 — 去重与时间冲突检测（spec 4.3.4）
 *
 * 判重分三档，配合前端「自动合并」闭环：
 *   - exact   完全重复：标题+内容一致          → action=skip（已存在，幂等返回）
 *   - similar 高度相似：标题相近 + 时间/内容重叠 → action=merge（更新已有条目）
 *   - related 可能相关：单一信号命中            → action=create（仍新建，仅提示）
 *
 * 原则：宁多勿漏（用户明确选择），similar 及以上由前端自动走合并路径。
 * 只检测与给建议，不在本模块写库；真正的合并动作由调用方（extract/entries 路由）执行。
 */

import { cosineSimilarity, getEmbedding } from '../rag/embeddings.js'
import { logger } from '../logger.js'
import { addLocalDays } from './timeParse.js'
import { expandOccurrences, type Recurrence } from './recurrence.js'
import { ENTITY_AUTO_MERGE_THRESHOLD, findBestEntityMatch } from './entityResolution.js'
import type { ExtractedEntry } from './extractor.js'

/** 未提供结束时间时，按 1 小时估算事件长度 */
export const DEFAULT_EVENT_MS = 3_600_000

export interface ExistingEntry {
  id: string
  type: string
  title: string
  content: string
  startAt: number | null
  endAt: number | null
  recurrence: Recurrence | null
  recurrenceUntil: number | null
}

export type DuplicateLevel = 'exact' | 'similar' | 'related'
/** skip=已存在无需操作；merge=更新已有；create=仍新建（仅提示） */
export type DuplicateAction = 'skip' | 'merge' | 'create'

export interface DuplicateInfo {
  entryId: string
  title: string
  /** 综合相似度 0-1，用于排序与展示 */
  similarity: number
  level: DuplicateLevel
  action: DuplicateAction
  /** 判重依据（给用户看的人话） */
  reason: string
}

export interface ConflictInfo {
  entryId: string
  title: string
  start: number
  end: number | null
}

export interface DedupeInfo {
  duplicate: DuplicateInfo | null
  conflicts: ConflictInfo[]
}

/** 半开区间重叠判断（无结束时间按 1 小时估算） */
export const intervalsOverlap = (
  aStart: number,
  aEnd: number | null,
  bStart: number,
  bEnd: number | null,
): boolean => {
  const aEndMs = aEnd ?? aStart + DEFAULT_EVENT_MS
  const bEndMs = bEnd ?? bStart + DEFAULT_EVENT_MS
  return aStart < bEndMs && bStart < aEndMs
}

const normalizeTitle = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？,.!?]/g, '')

const normalizeContent = (content: string): string =>
  content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？,.!?]/g, '')

/** 字符二元组相似度（不依赖 embedding，快速粗筛） */
export const bigramSimilarity = (a: string, b: string): number => {
  const grams = (text: string) => {
    const clean = text.replace(/\s+/g, '').toLowerCase()
    const set = new Set<string>()
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2))
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let shared = 0
  for (const gram of ga) if (gb.has(gram)) shared++
  return shared / Math.max(ga.size, gb.size)
}

/** 标题是否互相包含（归一化后）：「面试」vs「明天下午面试」 */
const titleContains = (a: string, b: string): boolean => {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (na.length < 2 || nb.length < 2) return false
  return na.includes(nb) || nb.includes(na)
}

/** 候选与已有条目的时间是否重叠（仅 schedule 有意义） */
const candidateTimeOverlap = (candidate: ExtractedEntry, entry: ExistingEntry): boolean => {
  if (candidate.type !== 'schedule' || !candidate.time) return false
  if (entry.type !== 'schedule' || entry.startAt === null) return false
  const newStart = candidate.time.start
  const newEnd = candidate.time.end ?? newStart + DEFAULT_EVENT_MS
  if (!entry.recurrence) {
    return intervalsOverlap(newStart, newEnd, entry.startAt, entry.endAt)
  }
  // 重复事件：只要新时间落在任意一次发生窗口内即算重叠
  const until = entry.recurrenceUntil ?? entry.recurrence.until ?? addLocalDays(Date.now(), 365)
  const duration = Math.max(DEFAULT_EVENT_MS, (entry.endAt ?? 0) - entry.startAt)
  const occurrences = expandOccurrences({
    startAt: entry.startAt,
    endAt: entry.endAt,
    recurrence: { ...entry.recurrence, until },
    windowStart: newStart - duration,
    windowEnd: newEnd,
    limit: 60,
  })
  return occurrences.some((occ) => intervalsOverlap(newStart, newEnd, occ.start, occ.end))
}

/** 完全重复（旧版严格判定，保留供精确比较场景使用）：类型 + 标题相同且相似度 > 0.9 */
export const findExactDuplicate = (
  candidate: ExtractedEntry,
  existing: ExistingEntry[],
  similarityOf: (entry: ExistingEntry) => number,
): { entryId: string; title: string; similarity: number } | null => {
  for (const entry of existing) {
    if (entry.type !== candidate.type) continue
    if (normalizeTitle(entry.title) !== normalizeTitle(candidate.title)) continue
    const similarity = similarityOf(entry)
    if (similarity > 0.9) {
      return { entryId: entry.id, title: entry.title, similarity }
    }
  }
  return null
}

/** 新日程与已有 active 日程的时间冲突 */
export const findTimeConflicts = (
  candidate: ExtractedEntry,
  existing: ExistingEntry[],
  nowMs: number,
  limit = 5,
): ConflictInfo[] => {
  if (candidate.type !== 'schedule' || !candidate.time) return []

  const newStart = candidate.time.start
  const newEnd = candidate.time.end ?? newStart + DEFAULT_EVENT_MS
  const conflicts: ConflictInfo[] = []

  for (const entry of existing) {
    if (entry.type !== 'schedule' || entry.startAt === null) continue

    if (!entry.recurrence) {
      if (intervalsOverlap(newStart, newEnd, entry.startAt, entry.endAt)) {
        conflicts.push({
          entryId: entry.id,
          title: entry.title,
          start: entry.startAt,
          end: entry.endAt,
        })
      }
    } else {
      const until = entry.recurrenceUntil ?? entry.recurrence.until ?? addLocalDays(nowMs, 365)
      const duration = Math.max(DEFAULT_EVENT_MS, (entry.endAt ?? 0) - entry.startAt)
      const occurrences = expandOccurrences({
        startAt: entry.startAt,
        endAt: entry.endAt,
        recurrence: { ...entry.recurrence, until },
        windowStart: newStart - duration,
        windowEnd: newEnd,
        limit: 60,
      })
      const hit = occurrences.find((occ) => intervalsOverlap(newStart, newEnd, occ.start, occ.end))
      if (hit) {
        conflicts.push({
          entryId: entry.id,
          title: entry.title,
          start: hit.start,
          end: hit.end,
        })
      }
    }

    if (conflicts.length >= limit) break
  }

  return conflicts
}

const entryText = (entry: { title: string; content: string }): string =>
  [entry.title, entry.content].filter(Boolean).join('\n')

/** 单条候选 vs 单条已有：基于标题/时间/内容相似度给出档位 */
const gradePair = (
  candidate: ExtractedEntry,
  entry: ExistingEntry,
  contentSim: number,
): DuplicateInfo | null => {
  const titleExact = normalizeTitle(candidate.title) === normalizeTitle(entry.title)
  const contain = titleContains(candidate.title, entry.title)
  const titleSim = bigramSimilarity(candidate.title, entry.title)
  const contentExact =
    normalizeContent(candidate.content) !== '' &&
    normalizeContent(candidate.content) === normalizeContent(entry.content)
  const timeHit = candidateTimeOverlap(candidate, entry)

  // exact：标题相同 + 内容一致（或几乎一致）
  if (titleExact && (contentExact || contentSim > 0.9)) {
    return {
      entryId: entry.id,
      title: entry.title,
      similarity: 1,
      level: 'exact',
      action: 'skip',
      reason: '标题和内容完全一致',
    }
  }

  // similar：多信号叠加，前端自动走「更新已有」
  if (titleExact && timeHit) {
    return {
      entryId: entry.id,
      title: entry.title,
      similarity: 0.95,
      level: 'similar',
      action: 'merge',
      reason: '标题相同且时间重叠',
    }
  }
  if (titleExact && contentSim > 0.7) {
    return {
      entryId: entry.id,
      title: entry.title,
      similarity: contentSim,
      level: 'similar',
      action: 'merge',
      reason: '标题相同，内容相近',
    }
  }
  if ((contain || titleSim > 0.6) && timeHit) {
    return {
      entryId: entry.id,
      title: entry.title,
      similarity: 0.85,
      level: 'similar',
      action: 'merge',
      reason: '标题相近且时间重叠',
    }
  }
  if ((contain || titleSim > 0.6) && contentSim > 0.75) {
    return {
      entryId: entry.id,
      title: entry.title,
      similarity: contentSim,
      level: 'similar',
      action: 'merge',
      reason: '标题和内容都相近',
    }
  }

  // related：单一信号命中，仅提示，不合并
  if (timeHit && contentSim > 0.6) {
    return {
      entryId: entry.id,
      title: entry.title,
      similarity: contentSim,
      level: 'related',
      action: 'create',
      reason: '时间重叠且内容相关',
    }
  }
  if (titleSim > 0.4 && contentSim > 0.6) {
    return {
      entryId: entry.id,
      title: entry.title,
      similarity: contentSim,
      level: 'related',
      action: 'create',
      reason: '标题与内容可能相关',
    }
  }

  return null
}

/** 是否需要为该已有条目计算 embedding（有标题或时间信号才算，省 API） */
const needEmbedding = (candidate: ExtractedEntry, entry: ExistingEntry): boolean => {
  if (entry.type !== candidate.type) return false
  if (normalizeTitle(candidate.title) === normalizeTitle(entry.title)) return true
  if (titleContains(candidate.title, entry.title)) return true
  if (bigramSimilarity(candidate.title, entry.title) > 0.4) return true
  if (candidateTimeOverlap(candidate, entry)) return true
  return false
}

/**
 * 综合判重：找出与候选最相似的一条已有记录。
 * 性能：先用标题/时间粗筛，仅对候选计算 embedding（最多 3 条）。
 */
export const findBestDuplicate = async (
  candidate: ExtractedEntry,
  existing: ExistingEntry[],
): Promise<DuplicateInfo | null> => {
  const candidates = existing.filter((entry) => entry.type === candidate.type)

  // 完全内容一致（同类型、同标题）的精确兜底优先，保持幂等语义。
  const identical = candidates.find(
    (entry) =>
      normalizeTitle(entry.title) === normalizeTitle(candidate.title) &&
      normalizeContent(entry.content) !== '' &&
      normalizeContent(entry.content) === normalizeContent(candidate.content),
  )
  if (identical) {
    return {
      entryId: identical.id,
      title: identical.title,
      similarity: 1,
      level: 'exact',
      action: 'skip',
      reason: '标题和内容完全一致',
    }
  }

  // GoldenMatch 只补充 fact/note 的跨类型、跨来源实体匹配，不改变日程判重规则。
  const entityMatch = findBestEntityMatch(candidate, existing)
  if (entityMatch && entityMatch.score >= ENTITY_AUTO_MERGE_THRESHOLD) {
    const entry = existing[entityMatch.index]!
    return {
      entryId: entry.id,
      title: entry.title,
      similarity: entityMatch.score,
      level: 'similar',
      action: 'merge',
      reason: `识别为同一实体「${entityMatch.entity}」（匹配度 ${Math.round(entityMatch.score * 100)}%）`,
    }
  }

  const pool = candidates.filter((entry) => needEmbedding(candidate, entry)).slice(0, 3)
  let best: DuplicateInfo | null = null
  if (pool.length > 0) {
    let candidateVector: number[]
    try {
      candidateVector = await getEmbedding(entryText(candidate))
    } catch (err) {
      logger.warn('extract', '去重向量计算失败，退化为仅标题/时间判重', {
        error: (err as Error).message,
      })
      // 向量失败时用 contentSim=0 跑一遍，纯标题/时间信号仍能出 similar（标题+时间）
      candidateVector = []
    }

    for (const entry of pool) {
      let contentSim = 0
      if (candidateVector.length > 0) {
        try {
          const vector = await getEmbedding(entryText(entry))
          contentSim = cosineSimilarity(candidateVector, vector)
        } catch (err) {
          logger.warn('extract', '已有条目向量计算失败，跳过该条内容比对', {
            entryId: entry.id,
            error: (err as Error).message,
          })
        }
      }
      const info = gradePair(candidate, entry, contentSim)
      if (info && (!best || info.similarity > best.similarity)) best = info
      // exact 已是最高档，提前退出
      if (best?.level === 'exact') break
    }
  }

  // 原有 similar/exact 优先；中分实体匹配只提示，仍由用户确认新建。
  if (best && (best.action !== 'create' || !entityMatch || best.similarity >= entityMatch.score)) {
    return best
  }
  if (entityMatch) {
    const entry = existing[entityMatch.index]!
    return {
      entryId: entry.id,
      title: entry.title,
      similarity: entityMatch.score,
      level: 'related',
      action: 'create',
      reason: `可能关联实体「${entityMatch.entity}」（匹配度 ${Math.round(entityMatch.score * 100)}%）`,
    }
  }
  return best
}

/**
 * 计算单条候选的去重信息（主入口）。
 * 返回三档判重 + 时间冲突，供前端做「自动合并」决策。
 */
export const buildDedupeInfo = async (
  candidate: ExtractedEntry,
  existing: ExistingEntry[],
  nowMs: number,
): Promise<DedupeInfo> => {
  const conflicts = findTimeConflicts(candidate, existing, nowMs)
  const duplicate = await findBestDuplicate(candidate, existing)
  return { duplicate, conflicts }
}
