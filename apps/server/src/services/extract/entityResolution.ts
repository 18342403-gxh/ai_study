/**
 * 轻量实体解析：GoldenMatch 负责人名/实体名相似度，业务代码负责类型边界与属性合并。
 * 仅 fact/note 参与跨类型实体合并，避免日程、规划被误并成资料条目。
 */

import { matchOne } from 'goldenmatch/core'

export const ENTITY_AUTO_MERGE_THRESHOLD = 0.95
export const ENTITY_RELATED_THRESHOLD = 0.8

export interface EntityRecord {
  type: string
  title: string
  content: string
}

export interface EntityMatch {
  index: number
  score: number
  entity: string
}

const KNOWLEDGE_TYPES = new Set(['fact', 'note'])
const ENTITY_PREFIX_RE =
  /^\s*([\u3400-\u9fff]{2,4}?)(?=是|的(?:简历|履历|资料|介绍|档案)|简历|履历|个人(?:资料|信息|介绍)|人物介绍)/
const SHORT_ENTITY_RE = /^[\u3400-\u9fff]{2,4}$/

/** 从「龚熙皓是…」「龚熙皓的简历」等开头提取实体名；无法确定时返回 null。 */
export const extractEntityName = (
  record: Pick<EntityRecord, 'title' | 'content'>,
): string | null => {
  for (const text of [record.title, record.content]) {
    const hit = ENTITY_PREFIX_RE.exec(text)
    if (hit?.[1]) return hit[1]
  }

  // 短标题只有得到正文呼应时才作为实体，避免把「健身」等普通主题自动合并。
  const title = record.title.trim()
  const content = record.content.trim()
  if (
    SHORT_ENTITY_RE.test(title) &&
    (content === title || content.startsWith(`${title}是`) || content.startsWith(`${title}，`))
  ) {
    return title
  }
  return null
}

const ENTITY_MATCHKEY = {
  name: 'entity_name',
  type: 'weighted',
  fields: [
    {
      field: 'name',
      transforms: ['strip', 'lowercase'],
      scorer: 'jaro_winkler',
      weight: 1,
    },
  ],
  threshold: ENTITY_RELATED_THRESHOLD,
} as const

/** 返回分数最高的同实体候选；调用方按阈值决定自动合并还是仅提示。 */
export const findBestEntityMatch = (
  target: EntityRecord,
  references: readonly EntityRecord[],
): EntityMatch | null => {
  if (!KNOWLEDGE_TYPES.has(target.type)) return null
  const targetName = extractEntityName(target)
  if (!targetName) return null

  const rows: Array<{ name: string; __row_id__: number }> = []
  const indexes: number[] = []
  references.forEach((record, index) => {
    if (!KNOWLEDGE_TYPES.has(record.type)) return
    const name = extractEntityName(record)
    if (!name) return
    rows.push({ name, __row_id__: rows.length })
    indexes.push(index)
  })
  if (rows.length === 0) return null

  const [best] = matchOne({ name: targetName }, rows, ENTITY_MATCHKEY)
  if (!best) return null
  const index = indexes[best.rowId]
  if (index === undefined) return null
  return { index, score: best.score, entity: targetName }
}

const normalizeFact = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？,.!?；;：:]/g, '')

const SOURCE_LABEL: Record<string, string> = {
  conversation: '对话',
  document: '文档',
  manual: '手动录入',
}

/**
 * 属性级追加合并：相同/包含关系去重，否则保留旧事实并追加新事实。
 * 不同来源的新事实带来源标签；原有 sourceType/sourceRef 仍描述首条来源。
 */
export const mergeEntryContent = (params: {
  existingContent: string
  incomingContent: string
  existingSourceType?: string
  incomingSourceType?: string
}): string => {
  const existing = params.existingContent.trim()
  const incoming = params.incomingContent.trim()
  if (!existing) return incoming
  if (!incoming) return existing

  const oldNormalized = normalizeFact(existing)
  const newNormalized = normalizeFact(incoming)
  if (oldNormalized.includes(newNormalized)) return existing
  if (newNormalized.includes(oldNormalized)) return incoming

  const sourceLabel =
    params.incomingSourceType && params.incomingSourceType !== params.existingSourceType
      ? `【来自${SOURCE_LABEL[params.incomingSourceType] ?? '其他来源'}】`
      : ''
  return `${existing}\n${sourceLabel}${incoming}`
}
