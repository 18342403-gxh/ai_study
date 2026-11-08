/**
 * 模型单价表 — spec 10.4
 *
 * 单价维护在 apps/server/config/models.json（价格变化频繁，不硬编码）。
 * 单位：元 / 1M tokens。
 *
 * 判定规则：
 *   - 表内 free=true 或输入输出单价均为 0 → 免费模型
 *   - 表内单价 > 0 → 付费模型（受月度预算熔断约束）
 *   - 表外未知模型 → 保守按付费处理（宁可误熔断，不静默超支），cost 返回 null
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '../logger.js'

interface PriceEntry {
  provider: string
  model: string
  free?: boolean
  input: number
  output: number
}

interface PriceTableFile {
  models: PriceEntry[]
}

let cache: Map<string, PriceEntry> | null = null

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, '../../../config/models.json')

const loadTable = (): Map<string, PriceEntry> => {
  if (cache) return cache
  cache = new Map()
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as PriceTableFile
    for (const entry of parsed.models ?? []) {
      cache.set(`${entry.provider}/${entry.model}`, entry)
    }
  } catch (err) {
    logger.warn('pricing', '单价表加载失败，所有模型按未知处理', {
      error: (err as Error).message,
      path: CONFIG_PATH,
    })
  }
  return cache
}

/** 测试用：重置缓存 */
export const resetPriceTableCache = (): void => {
  cache = null
}

const lookup = (provider: string, model: string): PriceEntry | null =>
  loadTable().get(`${provider}/${model}`) ?? null

/** 是否免费模型（未知模型保守按付费处理） */
export const isFreeModel = (provider: string, model: string): boolean => {
  const entry = lookup(provider, model)
  if (!entry) return false
  return entry.free === true || (entry.input === 0 && entry.output === 0)
}

/**
 * 估算单次调用成本（元）。
 * 返回 null 表示模型不在单价表中，无法估算。
 */
export const estimateCostYuan = (
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null => {
  const entry = lookup(provider, model)
  if (!entry) return null
  return (promptTokens / 1_000_000) * entry.input + (completionTokens / 1_000_000) * entry.output
}
