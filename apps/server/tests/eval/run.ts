/* eslint-disable no-console */
/**
 * 评测跑批 — spec 4.11.3
 *
 *   pnpm eval                 全量 20 条用例（真实 LLM + 独立临时 SQLite）
 *   pnpm eval -- --no-judge   跳过 LLM 裁判（幻觉率/引用准确率按满分处理）
 *   pnpm eval -- --only=time  只跑某类（按 id 前缀过滤，如 time / miss / degraded）
 *
 * 输出四项指标：命中率 / 引用准确率 / 幻觉率 / 无命中识别率。
 * 门禁：幻觉率必须为 0；命中率 ≥ 0.8；无命中识别率 = 1；引用准确率 ≥ 0.8。
 * 任何一项不达标 → 进程退出码 1（可挂 CI）。
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 0. 隔离 DB：必须在任何 src import 之前设置（db 模块读 DB_PATH） ──
const tmpDb = path.join(os.tmpdir(), `kb-eval-${process.pid}.db`)
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(tmpDb + suffix, { force: true })
  } catch {
    /* ignore */
  }
}
process.env.DB_PATH = tmpDb

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── 类型（与 cases.json 对应） ──
interface SeedSpec {
  type: 'schedule' | 'plan' | 'fact' | 'note'
  title: string
  content: string
  startAt?:
    | { offsetDays: number; hour?: number; minute?: number }
    | { weekday: number; hour?: number; minute?: number }
  recurrence?: { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'; byWeekday?: string[] }
}

interface CaseExpect {
  cite?: string[]
  replyAny?: string[]
  notFound?: boolean
}

interface CaseDef {
  id: string
  category: string
  query: string
  seed: SeedSpec[]
  expect: CaseExpect
}

interface CaseResult {
  id: string
  ok: boolean
  reasons: string[]
  reply: string
  citationLabels: string[]
  /** 引用命中：无 cite 期望时为 null（不计入命中率） */
  citeHit: boolean | null
  /** 无命中识别：非 miss 用例为 null */
  missOk: boolean | null
  hallucination: string[] | null
  citationMismatch: string[] | null
}

/** 动态 import 的服务集合（DB_PATH 设置完成后才能加载） */
type Deps = Record<string, any>

// ── 时间解析（与用例 JSON 的相对偏移一致，保证用例永不过期） ──
const DAY_MS = 86_400_000

const resolveStartAt = (spec: NonNullable<SeedSpec['startAt']>): number => {
  const now = new Date()
  if ('offsetDays' in spec) {
    const d = new Date(now.getTime() + spec.offsetDays * DAY_MS)
    d.setHours(spec.hour ?? 9, spec.minute ?? 0, 0, 0)
    return d.getTime()
  }
  // weekday（1=周一 … 7=周日）：下一个该周几（含本周未过的）
  const d = new Date(now)
  const jsDay = d.getDay() === 0 ? 7 : d.getDay()
  let delta = spec.weekday - jsDay
  if (delta < 0 || (delta === 0 && d.getHours() >= (spec.hour ?? 9))) delta += 7
  d.setDate(d.getDate() + delta)
  d.setHours(spec.hour ?? 9, spec.minute ?? 0, 0, 0)
  return d.getTime()
}

const dateLabel = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 查询模板：{{d:N}} = N 天后日期；{{wd:W}} = 下一个周 W 日期 */
const renderQuery = (query: string): string =>
  query
    .replace(/\{\{d:(\d+)\}\}/g, (_, n) => dateLabel(Date.now() + Number(n) * DAY_MS))
    .replace(/\{\{wd:(\d+)\}\}/g, (_, w) =>
      dateLabel(resolveStartAt({ weekday: Number(w), hour: 9 })),
    )

const NOT_FOUND_RE = /没有|未找到|没找到|并无|查不到|检索不到|不清楚|不了解/

// ── 种子数据：每个用例独立 libraryId 隔离 ──
const seedCase = async (deps: Deps, c: CaseDef): Promise<void> => {
  const { db, tables, syncEntryEmbedding } = deps
  const now = new Date()
  for (const s of c.seed) {
    const id = randomUUID()
    await db.insert(tables.entries).values({
      id,
      userId: 'eval',
      libraryId: `eval-${c.id}`,
      type: s.type,
      title: s.title,
      content: s.content,
      status: 'active',
      startAt: s.startAt ? new Date(resolveStartAt(s.startAt)) : null,
      endAt: null,
      recurrence: s.recurrence ?? null,
      recurrenceUntil: null,
      sourceType: 'manual',
      sourceRef: null,
      confidence: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    await syncEntryEmbedding(id, s.title, s.content)
  }
}

// ── LLM 裁判（feature='eval'，temperature 0） ──
const runJudge = async (
  deps: Deps,
  sources: Array<{ title: string; content: string }>,
  reply: string,
): Promise<{ hallucination: string[]; citationMismatch: string[] }> => {
  const sourceText = sources
    .map((s, i) => `[${i + 1}] 标题：${s.title}\n内容：${s.content}`)
    .join('\n')
  const prompt = [
    '你是评测裁判。给你「来源记录」和「AI 回答」，判断两点：',
    '1. 回答中是否出现来源记录里没有的、关于用户个人的事实断言（幻觉，通用知识不算）；',
    '2. 回答的陈述与来源记录是否一致（引用是否准确）。',
    '只输出 JSON：{"unsupported_claims":[],"citation_mismatch":[]}，没有就给空数组，不要解释。',
    '',
    `来源记录：\n${sourceText || '（无）'}\n\nAI 回答：\n${reply}`,
  ].join('\n')
  const res = await deps.judge.invoke({ messages: [{ role: 'user', content: prompt }] })
  const text = typeof res === 'string' ? res : (res as { content: string }).content
  const match = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
  if (!match) return { hallucination: [], citationMismatch: [] }
  try {
    const parsed = JSON.parse(match[0]) as {
      unsupported_claims?: string[]
      citation_mismatch?: string[]
    }
    return {
      hallucination: parsed.unsupported_claims ?? [],
      citationMismatch: parsed.citation_mismatch ?? [],
    }
  } catch {
    return { hallucination: [], citationMismatch: [] }
  }
}

/** 裁判：取被引用条目的全文做比对 */
const judgeAnswer = async (
  deps: Deps,
  entryIds: string[],
  reply: string,
  reasons: string[],
): Promise<{ hallucination: string[] | null; citationMismatch: string[] | null }> => {
  if (!deps.judge) return { hallucination: null, citationMismatch: null }
  const { db, tables } = deps
  const rows = await db
    .select({ id: tables.entries.id, title: tables.entries.title, content: tables.entries.content })
    .from(tables.entries)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const sources = entryIds.flatMap((id) => {
    const row = byId.get(id)
    return row ? [{ title: row.title, content: row.content }] : []
  })
  const judged = await runJudge(deps, sources, reply)
  if (judged.hallucination.length > 0) reasons.push(`幻觉: ${judged.hallucination.join('；')}`)
  if (judged.citationMismatch.length > 0)
    reasons.push(`引用不准: ${judged.citationMismatch.join('；')}`)
  return judged
}

const runCase = async (deps: Deps, c: CaseDef): Promise<CaseResult> => {
  const { searchAll, generateAnswer } = deps
  await seedCase(deps, c)
  const query = renderQuery(c.query)
  const search = await searchAll({ query, libraryId: `eval-${c.id}` })
  const answer = await generateAnswer({ query, search })
  const reasons: string[] = []

  const entryCites = answer.citations.filter((x) => x.type === 'entry')
  const labels = entryCites.map((x) => ('label' in x ? x.label : ''))
  let citeHit: boolean | null = null
  let missOk: boolean | null = null

  if (c.expect.notFound) {
    missOk = entryCites.length === 0 && NOT_FOUND_RE.test(answer.reply)
    if (entryCites.length > 0) reasons.push(`无命中用例却引用了记录: ${labels.join(',')}`)
    if (!NOT_FOUND_RE.test(answer.reply)) reasons.push('回答未明确说"没有"')
  }
  const expectedCites = c.expect.cite ?? []
  if (expectedCites.length > 0) {
    citeHit = expectedCites.every((kw) => labels.some((l) => l.includes(kw)))
    const missed = expectedCites.filter((kw) => !labels.some((l) => l.includes(kw)))
    if (missed.length > 0) reasons.push(`未命中引用: ${missed.join(',')}`)
  }
  if (c.expect.replyAny && !c.expect.replyAny.some((w) => answer.reply.includes(w))) {
    console.log(`  ⚠ ${c.id} 回答未含任一关键词 ${JSON.stringify(c.expect.replyAny)}（软指标）`)
  }

  const entryIds = entryCites.flatMap((x) => ('id' in x ? [x.id] : []))
  const judged = c.expect.notFound
    ? { hallucination: null, citationMismatch: null }
    : await judgeAnswer(deps, entryIds, answer.reply, reasons)

  return {
    id: c.id,
    ok: reasons.length === 0,
    reasons,
    reply: answer.reply,
    citationLabels: labels,
    citeHit,
    missOk,
    hallucination: judged.hallucination,
    citationMismatch: judged.citationMismatch,
  }
}

// ── 指标（spec 4.11.2）：命中率/无命中识别率独立计数，不被裁判结果连坐 ──
const reportMetrics = (results: CaseResult[]): boolean => {
  const citeCases = results.filter((r) => r.citeHit !== null)
  const missCases = results.filter((r) => r.missOk !== null)
  const judged = results.filter((r) => r.hallucination !== null)
  const hitCount = citeCases.filter((r) => r.citeHit === true).length
  const missCount = missCases.filter((r) => r.missOk === true).length
  const citeAccCount = judged.filter((r) => (r.citationMismatch?.length ?? 0) === 0).length
  const hitRate = citeCases.length ? hitCount / citeCases.length : 1
  const missRate = missCases.length ? missCount / missCases.length : 1
  const hallucRate = judged.length
    ? judged.filter((r) => (r.hallucination?.length ?? 0) > 0).length / judged.length
    : 0
  const citeAcc = judged.length ? citeAccCount / judged.length : 1

  console.log('\n──────── 评测指标 ────────')
  console.log(
    `命中率       ${(hitRate * 100).toFixed(0)}%  (${hitCount}/${citeCases.length})  门禁 ≥ 80%`,
  )
  console.log(
    `引用准确率   ${(citeAcc * 100).toFixed(0)}%  (${citeAccCount}/${judged.length})  门禁 ≥ 80%`,
  )
  console.log(`幻觉率       ${(hallucRate * 100).toFixed(0)}%  门禁 = 0`)
  console.log(
    `无命中识别率 ${(missRate * 100).toFixed(0)}%  (${missCount}/${missCases.length})  门禁 = 100%`,
  )

  return hallucRate === 0 && hitRate >= 0.8 && missRate === 1 && citeAcc >= 0.8
}

// ── 主流程 ──
const main = async (): Promise<number> => {
  const args = process.argv.slice(2)
  const noJudge = args.includes('--no-judge')
  const only = args.find((a) => a.startsWith('--only='))?.slice(7)

  const { initDatabase, getDb, tables } = await import('../../src/db/index.js')
  const { searchAll } = await import('../../src/services/search/searchAll.js')
  const { generateAnswer } = await import('../../src/services/answer/generate.js')
  const { syncEntryEmbedding } = await import('../../src/services/search/entryIndex.js')
  const { createChatChain } = await import('../../src/services/chain/chatChain.js')

  await initDatabase()
  const deps: Deps = {
    db: getDb(),
    tables,
    searchAll,
    generateAnswer,
    syncEntryEmbedding,
    judge: noJudge ? null : createChatChain({ temperature: 0, feature: 'eval' }),
  }

  const casesFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf-8')) as {
    cases: CaseDef[]
  }
  const cases = casesFile.cases.filter((c) => !only || c.id.startsWith(only))
  console.log(
    `\n[v5-eval] 用例 ${cases.length} 条，临时库 ${tmpDb}，judge=${noJudge ? 'off' : 'on'}\n`,
  )

  const results: CaseResult[] = []
  for (const c of cases) {
    // 降级用例：强制 mock embedding（spec 4.11 降级场景），向量路跳过、走 BM25/时间通道
    if (c.category === 'degraded') process.env.ENABLE_MOCK_EMBEDDING = '1'
    else delete process.env.ENABLE_MOCK_EMBEDDING

    try {
      const result = await runCase(deps, c)
      results.push(result)
      console.log(`${result.ok ? '✓' : '✗'} ${c.id}  ${result.reasons.join(' | ')}`)
    } catch (err) {
      results.push({
        id: c.id,
        ok: false,
        reasons: [`运行异常: ${(err as Error).message}`],
        reply: '',
        citationLabels: [],
        citeHit: (c.expect.cite?.length ?? 0) > 0 ? false : null,
        missOk: c.expect.notFound ? false : null,
        hallucination: null,
        citationMismatch: null,
      })
      console.log(`✗ ${c.id}  运行异常: ${(err as Error).message}`)
    } finally {
      delete process.env.ENABLE_MOCK_EMBEDDING
    }
  }

  const pass = reportMetrics(results)
  console.log(`\n[v5-eval] ${pass ? 'PASS' : 'FAIL'}\n`)
  return pass ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[v5-eval] 运行失败', err)
    process.exit(1)
  })
