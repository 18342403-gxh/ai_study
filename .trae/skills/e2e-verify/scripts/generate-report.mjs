#!/usr/bin/env node
/**
 * Playwright E2E 验证报告生成器
 *
 * 从 playwright-report/results.json 读取测试结果，生成 Markdown 报告
 * 用法：
 *   node .trae/skills/e2e-verify/scripts/generate-report.mjs --feature <功能名> [--url <目标URL>]
 *
 * 输出：docs/e2e-reports/<feature>-<timestamp>.md
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '../../..')

// ── 解析参数 ──
const args = process.argv.slice(2)
const featureIdx = args.indexOf('--feature')
const urlIdx = args.indexOf('--url')
const featureName = featureIdx >= 0 ? args[featureIdx + 1] : 'unknown'
const targetUrl = urlIdx >= 0 ? args[urlIdx + 1] : process.env.E2E_BASE_URL || 'http://localhost:3003'

// ── 读取 Playwright JSON 报告 ──
const reportPath = join(PROJECT_ROOT, 'playwright-report', 'results.json')
if (!existsSync(reportPath)) {
  console.error('❌ 找不到 Playwright JSON 报告:', reportPath)
  console.error('请先运行: npx playwright test')
  process.exit(1)
}

const raw = readFileSync(reportPath, 'utf-8')
const report = JSON.parse(raw)

// ── 提取结果 ──
const suites = report.suites || []
const cases = []

function walkSuites(suites, parentTitle = '') {
  for (const suite of suites) {
    const fullTitle = parentTitle ? `${parentTitle} > ${suite.title}` : suite.title
    if (suite.suites) walkSuites(suite.suites, fullTitle)
    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const test of spec.tests) {
          const result = test.results?.[test.results.length - 1]
          cases.push({
            title: spec.title,
            fullTitle: spec.fullTitle || `${fullTitle} > ${spec.title}`,
            status: test.outcome === 'expected' ? 'passed'
              : test.outcome === 'unexpected' ? 'failed'
              : test.outcome === 'skipped' ? 'skipped'
              : test.outcome,
            duration: result?.duration || 0,
            error: result?.error?.message || null,
            screenshot: result?.attachments?.find((a) => a.name === 'screenshot')?.path || null,
          })
        }
      }
    }
  }
}
walkSuites(suites)

// ── 统计 ──
const total = cases.length
const passed = cases.filter((c) => c.status === 'passed').length
const failed = cases.filter((c) => c.status === 'failed').length
const skipped = cases.filter((c) => c.status === 'skipped').length
const passRate = total > 0 ? Math.round((passed / total) * 100) : 0
const totalDuration = cases.reduce((sum, c) => sum + c.duration, 0)

// ── 生成 Markdown ──
const now = new Date()
const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
const fileStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

const md = [
  `# E2E 验证报告：${featureName}`,
  '',
  `- **时间**: ${timestamp}`,
  `- **目标 URL**: ${targetUrl}`,
  `- **Playwright**: ${report.config?.version || 'unknown'} (chromium)`,
  '',
  '## 概览',
  '',
  '| 指标 | 值 |',
  '|------|-----|',
  `| 总用例 | ${total} |`,
  `| ✅ 通过 | ${passed} |`,
  `| ❌ 失败 | ${failed} |`,
  `| ⏭️ 跳过 | ${skipped} |`,
  `| 通过率 | ${passRate}% |`,
  `| 耗时 | ${(totalDuration / 1000).toFixed(1)}s |`,
  '',
  '## 用例详情',
  '',
  '| # | 用例名 | 状态 | 耗时 | 错误 |',
  '|---|--------|------|------|------|',
  ...cases.map((c, i) => {
    const icon = c.status === 'passed' ? '✅' : c.status === 'failed' ? '❌' : '⏭️'
    const err = c.error ? c.error.replace(/\n/g, ' ').slice(0, 100) : '-'
    return `| ${i + 1} | ${c.title} | ${icon} | ${(c.duration / 1000).toFixed(1)}s | ${err} |`
  }),
  '',
  '## 失败详情',
  '',
  ...cases
    .filter((c) => c.status === 'failed')
    .map((c) => {
      const lines = [`### ❌ ${c.title}`, '', `**错误**: \`${c.error || 'unknown'}\``]
      if (c.screenshot) {
        const relPath = c.screenshot.replace(PROJECT_ROOT + '\\', '').replace(/\\/g, '/')
        lines.push(``, `**截图**: ${relPath}`)
      }
      return lines.join('\n')
    }),
  ...(failed === 0 ? ['_无失败用例_'] : []),
  '',
  '## 结论',
  '',
  failed === 0
    ? '- ✅ 所有核心功能通过，可以进入下一阶段'
    : `- ⚠️ 存在 ${failed} 个失败用例，需要修复后重新验证`,
  '',
].join('\n')

// ── 写入文件 ──
const outputDir = join(PROJECT_ROOT, 'docs', 'e2e-reports')
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
const slug = featureName.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
const outputPath = join(outputDir, `${slug}-${fileStamp}.md`)
writeFileSync(outputPath, md, 'utf-8')

// ── 输出摘要 ──
console.log('╔══════════════════════════════════════╗')
console.log('║  E2E 验证报告生成完成                ║')
console.log('╚══════════════════════════════════════╝')
console.log(`  功能: ${featureName}`)
console.log(`  时间: ${timestamp}`)
console.log(`  结果: ${passed}/${total} 通过（${passRate}%）`)
console.log(`  报告: ${outputPath}`)
console.log('')
if (failed > 0) {
  console.log('❌ 失败用例:')
  for (const c of cases.filter((x) => x.status === 'failed')) {
    console.log(`   - ${c.title}: ${(c.error || '').slice(0, 80)}`)
  }
  console.log('')
}
console.log('📊 HTML 报告: playwright-report/index.html')
console.log('   运行 npx playwright show-report 打开')
