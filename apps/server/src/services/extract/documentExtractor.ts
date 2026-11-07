/**
 * 抽取链路 — 文档抽取为记录（spec 4.3.8，阶段 5）
 *
 * 流程：
 *   1. 用户选择范围（整篇 / 指定块），路由侧已裁剪到 100 块以内
 *   2. 每 5 块一组批量抽取，复用对话抽取的 Prompt 与输出结构
 *   3. 批次失败跳过并计数，块级失败不影响其他块
 *   4. 候选条目去重后最多返回 10 条，其余给出剩余数量
 *
 * 本模块只负责抽取与聚合，不写库；确认入库走 POST /api/entries
 * （sourceType='document'，sourceRef=docId）。
 */

import {
  extractEntries,
  type ExtractOutcome,
  type ExtractedEntry,
  type ExtractOptions,
  type PromptEntry,
} from './extractor.js'

/** 单次最多处理的块数（spec 4.3.8） */
export const MAX_DOC_CHUNKS = 100
/** 每次模型调用处理的块数 */
export const DOC_CHUNK_BATCH_SIZE = 5
/** 单次最多返回的候选条目数 */
export const MAX_DOC_ENTRIES = 10

export interface DocumentChunkInput {
  id: string
  chunkIndex: number
  content: string
}

export interface DocumentExtractParams {
  chunks: DocumentChunkInput[]
  nowMs: number
  timezone: string
  existingEntries?: PromptEntry[]
  /** 测试注入；默认使用 extractEntries */
  extract?: (options: ExtractOptions) => Promise<ExtractOutcome>
  invoke?: ExtractOptions['invoke']
  timeoutMs?: number
}

export interface DocumentExtractResult {
  entries: ExtractedEntry[]
  truncated: boolean
  remaining: number
  /** 成功抽取的块数 */
  chunksProcessed: number
  /** 失败批次的块数 */
  failedChunks: number
  /** 成功抽取的块 id，用于写 extracted_at */
  succeededChunkIds: string[]
}

/** 按固定大小分组 */
export const groupChunks = <T>(items: T[], size = DOC_CHUNK_BATCH_SIZE): T[][] => {
  const groups: T[][] = []
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size))
  return groups
}

const candidateKey = (entry: ExtractedEntry): string =>
  `${entry.type}|${entry.title.trim()}|${entry.content.trim()}`

/** 同一批候选内部去重（跨块重复提到同一件事时只保留一条） */
export const dedupeCandidates = (entries: ExtractedEntry[]): ExtractedEntry[] => {
  const seen = new Set<string>()
  const result: ExtractedEntry[] = []
  for (const entry of entries) {
    const key = candidateKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry)
  }
  return result
}

/** 一批块拼成一段文本，块之间用分隔线标注，避免模型串块 */
export const buildBatchText = (batch: DocumentChunkInput[]): string =>
  batch.map((chunk, index) => `【第 ${index + 1} 块】\n${chunk.content}`).join('\n\n---\n\n')

/** 文档候选条目抽取 */
export const extractDocumentChunks = async (
  params: DocumentExtractParams,
): Promise<DocumentExtractResult> => {
  const extract = params.extract ?? extractEntries
  const collected: ExtractedEntry[] = []
  const succeededChunkIds: string[] = []
  let failedChunks = 0

  for (const batch of groupChunks(params.chunks)) {
    const outcome = await extract({
      text: buildBatchText(batch),
      mode: 'document',
      maxEntries: MAX_DOC_CHUNKS,
      now: params.nowMs,
      timezone: params.timezone,
      existingEntries: params.existingEntries,
      invoke: params.invoke,
      timeoutMs: params.timeoutMs,
    })

    if (!outcome.ok) {
      failedChunks += batch.length
      continue
    }

    succeededChunkIds.push(...batch.map((chunk) => chunk.id))
    collected.push(...outcome.entries)
  }

  const unique = dedupeCandidates(collected)
  const entries = unique.slice(0, MAX_DOC_ENTRIES)

  return {
    entries,
    truncated: unique.length > MAX_DOC_ENTRIES,
    remaining: Math.max(0, unique.length - MAX_DOC_ENTRIES),
    chunksProcessed: succeededChunkIds.length,
    failedChunks,
    succeededChunkIds,
  }
}
