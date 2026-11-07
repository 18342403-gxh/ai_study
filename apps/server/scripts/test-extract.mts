/**
 * 阶段 4 手动冒烟：真实 LLM 抽取
 *
 * 运行：
 *   pnpm --filter @ai-study/server exec tsx scripts/test-extract.mts
 */

import 'dotenv/config'
import { extractEntries } from '../src/services/extract/extractor.js'

const cases = [
  {
    text: '每周一早上九点开周会',
    check: (out: Awaited<ReturnType<typeof extractEntries>>) => {
      const entry = out.entries[0]
      if (!entry) return '没有抽取到条目'
      if (entry.type !== 'schedule') return `type 期望 schedule，实际 ${entry.type}`
      if (entry.recurrence?.freq !== 'WEEKLY') return `freq 期望 WEEKLY，实际 ${entry.recurrence?.freq}`
      if (!entry.recurrence?.byWeekday?.includes('MO')) return 'byWeekday 缺少 MO'
      if (!entry.time?.startText.includes('09:00')) return `startText 缺少 09:00：${entry.time?.startText}`
      return null
    },
  },
  {
    text: '下周三下午两点交方案',
    check: (out: Awaited<ReturnType<typeof extractEntries>>) => {
      const entry = out.entries[0]
      if (!entry) return '没有抽取到条目'
      if (!entry.time) return '没有解析出时间'
      return null
    },
  },
]

let failed = 0

for (const item of cases) {
  process.stdout.write(`\n=== ${item.text} ===\n`)
  const outcome = await extractEntries({ text: item.text })

  process.stdout.write(
    JSON.stringify(
      {
        ok: outcome.ok,
        intent: outcome.intent,
        failed: outcome.failed,
        reply: outcome.reply,
        entries: outcome.entries.map((entry) => ({
          type: entry.type,
          title: entry.title,
          time: entry.time?.startText ?? null,
          recurrence: entry.recurrence,
          recurrenceText: entry.recurrenceText,
          confidence: entry.confidence,
          needsReview: entry.needsReview,
          warnings: entry.warnings,
        })),
      },
      null,
      2,
    ) + '\n',
  )

  if (!outcome.ok) {
    process.stdout.write(`✗ 抽取失败：${outcome.failed}\n`)
    failed++
    continue
  }

  const problem = item.check(outcome)
  if (problem) {
    process.stdout.write(`✗ ${problem}\n`)
    failed++
  } else {
    process.stdout.write('✓ 通过\n')
  }
}

if (failed > 0) {
  process.stdout.write(`\n${failed} 个用例未通过\n`)
  process.exit(1)
}
process.stdout.write('\n全部通过\n')
