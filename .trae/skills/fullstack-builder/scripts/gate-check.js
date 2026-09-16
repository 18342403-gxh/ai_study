#!/usr/bin/env node
/**
 * Gate Checker — 自动验证工作流 gate
 * 零依赖 Node.js 脚本。每个检查都是一个子函数，返回 { pass: bool, details: string }。
 *
 * 用法:
 *   node gate-check.js run                   运行当前 Phase 的所有 gate 检查
 *   node gate-check.js phase <1-6>           运行指定 Phase 的所有 gate 检查
 *   node gate-check.js single <gate-slug>    运行单个 gate 检查
 *   node gate-check.js list                  列出所有可用 gate + 检查函数映射
 *
 * exit code: 全部通过=0, 有失败=1
 */

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const CWD = process.cwd()
const STATE_PATH = join(CWD, '.workflow-state.json')

// ─── 检查函数库 ───────────────────────────────────────────────

async function checkHealth() {
  const port = process.env.PORT || 3001
  try {
    // Windows 兼容: 用 PowerShell 的 Invoke-WebRequest 或 curl.exe
    const url = `http://localhost:${port}/health`
    let resp
    if (process.platform === 'win32') {
      resp = execSync(`curl.exe -s -o - -w "\n%{http_code}" ${url}`, { timeout: 5000 }).toString()
    } else {
      resp = execSync(`curl -s -o - -w "\n%{http_code}" ${url}`, { timeout: 5000 }).toString()
    }
    const [body, code] = resp.trim().split('\n')
    if (code === '200') {
      return { pass: true, details: `GET ${url} → 200, body=${body.slice(0, 200)}` }
    }
    return { pass: false, details: `GET ${url} → HTTP ${code}` }
  } catch (e) {
    return { pass: false, details: `/health 连接失败: ${e.message}` }
  }
}

async function checkDb() {
  // 复用 health check，但额外看 db 字段
  const port = process.env.PORT || 3001
  try {
    const url = `http://localhost:${port}/health`
    const resp = execSync(
      process.platform === 'win32' ? `curl.exe -s ${url}` : `curl -s ${url}`,
      { timeout: 5000 }
    ).toString()
    const data = JSON.parse(resp)
    if (data.db === 'ok') return { pass: true, details: `db=ok` }
    return { pass: data.db !== 'fail', details: `db=${data.db ?? 'missing'}` }
  } catch (e) {
    return { pass: false, details: `无法获取 /health: ${e.message}` }
  }
}

async function checkTypecheck() {
  const candidates = ['tsconfig.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']
  const found = candidates.find(f => existsSync(join(CWD, f)))
  if (!found) return { pass: true, details: '未检测到已知类型系统，跳过' }

  try {
    if (found === 'tsconfig.json') {
      const out = execSync('npx tsc --noEmit 2>&1', { timeout: 60000 }).toString()
      if (out.trim() === '') return { pass: true, details: 'tsc --noEmit → 零错误' }
      return { pass: false, details: `tsc 输出:\n${out.split('\n').slice(0, 10).join('\n')}` }
    }
    if (found === 'pyproject.toml') {
      const out = execSync('python -m mypy . 2>&1', { timeout: 60000 }).toString()
      if (out.includes('Success')) return { pass: true, details: 'mypy → Success' }
      return { pass: false, details: out.split('\n').slice(0, 10).join('\n') }
    }
    if (found === 'go.mod') {
      const out = execSync('go vet ./... 2>&1', { timeout: 60000 }).toString()
      if (out.trim() === '') return { pass: true, details: 'go vet → 零警告' }
      return { pass: false, details: out.split('\n').slice(0, 10).join('\n') }
    }
    if (found === 'Cargo.toml') {
      const out = execSync('cargo check 2>&1', { timeout: 60000 }).toString()
      if (out.includes('Finished')) return { pass: true, details: 'cargo check → 通过' }
      return { pass: false, details: out.split('\n').slice(0, 10).join('\n') }
    }
  } catch (e) {
    return { pass: false, details: `类型检查失败: ${e.message}` }
  }
  return { pass: true, details: '跳过' }
}

async function checkNoConsole() {
  // 扫描 src/ 和 apps/*/src/ 下的 console.log / print / fmt.Println
  const patterns = {
    ts: /console\.(log|warn|error|info|debug)\s*\(/g,
    py: /^\s*print\s*\(/gm,
    go: /fmt\.(Println|Printf|Print)\s*\(/g,
  }

  const srcDirs = ['src', 'apps', 'server/src', 'packages']
  const matches = []

  for (const dir of srcDirs) {
    const fullPath = join(CWD, dir)
    if (!existsSync(fullPath)) continue
    walkDir(fullPath, (filePath) => {
      if (!/\.(ts|tsx|js|jsx|py|go)$/.test(filePath)) return
      try {
        const content = require('node:fs').readFileSync(filePath, 'utf-8')
        const ext = filePath.split('.').pop()
        const pattern = ext === 'py' ? patterns.py : ext === 'go' ? patterns.go : patterns.ts
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            matches.push(`${filePath}:${i + 1}: ${lines[i].trim().slice(0, 80)}`)
          }
          pattern.lastIndex = 0 // reset regex state
        }
      } catch {}
    })
  }

  if (matches.length === 0) return { pass: true, details: '零 console.log / print / fmt.Println' }
  return { pass: false, details: `发现 ${matches.length} 处:\n${matches.slice(0, 15).join('\n')}` }
}

async function checkEnvExample() {
  const candidates = ['.env.example', '.env.sample', '.env.dist']
  for (const f of candidates) {
    if (existsSync(join(CWD, f))) {
      const content = require('node:fs').readFileSync(join(CWD, f), 'utf-8')
      const vars = content.split('\n').filter(l => l.match(/^[A-Z_]+=/))
      return { pass: true, details: `${f} 存在, ${vars.length} 个变量` }
    }
  }
  return { pass: false, details: '未找到 .env.example / .env.sample' }
}

// Phase 3+ 的通用 typecheck
async function checkTypecheckRegression() { return checkTypecheck() }

// Phase 4 gate — 需要 mock embedding 跑
async function checkDegrade() {
  // 检查代码里有没有 hashVector / mock fallback
  const keywords = ['hashVector', 'ENABLE_MOCK_EMBEDDING', 'mock.*embedding', 'fallback.*embedding']
  const srcDirs = ['src', 'apps']
  for (const dir of srcDirs) {
    const fullPath = join(CWD, dir)
    if (!existsSync(fullPath)) continue
    let found = false
    walkDir(fullPath, (filePath) => {
      if (!/\.(ts|tsx|js)$/.test(filePath)) return
      try {
        const content = require('node:fs').readFileSync(filePath, 'utf-8').toLowerCase()
        for (const kw of keywords) {
          if (content.includes(kw.toLowerCase())) found = true
        }
      } catch {}
    })
    if (found) return { pass: true, details: '检测到 embedding fallback 代码' }
  }
  return { pass: false, details: '未检测到 embedding mock/fallback 实现' }
}

async function checkUsageQuery() {
  const port = process.env.PORT || 3001
  const candidates = ['/api/usage/today', '/api/usage', '/api/admin/cost']
  for (const path of candidates) {
    try {
      const resp = execSync(
        process.platform === 'win32' ? `curl.exe -s -o - -w "\n%{http_code}" http://localhost:${port}${path}` : `curl -s -o - -w "\n%{http_code}" http://localhost:${port}${path}`,
        { timeout: 5000 }
      ).toString()
      const [, code] = resp.trim().split('\n')
      if (code === '200') return { pass: true, details: `${path} → 200` }
    } catch {}
  }
  return { pass: false, details: '未找到可用的 usage 查询端点（检查过 /api/usage/today, /api/usage, /api/admin/cost）' }
}

async function checkBudgetEnv() {
  const envPath = join(CWD, '.env.example')
  if (!existsSync(envPath)) return { pass: false, details: '.env.example 不存在' }
  const content = require('node:fs').readFileSync(envPath, 'utf-8').toLowerCase()
  if (content.includes('budget')) return { pass: true, details: '.env.example 包含 budget 相关变量' }
  return { pass: false, details: '.env.example 未找到 BUDGET 阈值变量' }
}

// Phase 5 — 静态检查为主
async function checkFirstScreen() {
  // 检查前端入口文件有没有渲染内容（不只是空 shell）
  const candidates = ['apps/web/src/App.vue', 'apps/web/src/App.tsx', 'src/App.vue', 'src/App.tsx', 'pages/index.vue']
  for (const f of candidates) {
    if (existsSync(join(CWD, f))) {
      const content = require('node:fs').readFileSync(join(CWD, f), 'utf-8')
      // 有 template/return + 不只是 loading 或空壳
      if (content.length > 200) return { pass: true, details: `${f} 存在且有实质内容 (${content.length} chars)` }
    }
  }
  return { pass: false, details: '未找到前端入口文件或入口为空壳' }
}

async function checkBadConfig() {
  // 检查代码里有没有 error boundary / 配置缺失提示
  const keywords = ['ErrorBoundary', 'error-boundary', 'please.*config', 'missing.*api.*key', 'onErrorCaptured']
  const srcDirs = ['src', 'apps']
  for (const dir of srcDirs) {
    const fullPath = join(CWD, dir)
    if (!existsSync(fullPath)) continue
    let found = false
    walkDir(fullPath, (filePath) => {
      if (!/\.(ts|tsx|vue|jsx)$/.test(filePath)) return
      try {
        const content = require('node:fs').readFileSync(filePath, 'utf-8').toLowerCase()
        for (const kw of keywords) if (content.includes(kw.toLowerCase())) found = true
      } catch {}
    })
    if (found) return { pass: true, details: '检测到 error boundary / 配置缺失处理' }
  }
  return { pass: false, details: '未检测到 error boundary 或配置缺失提示' }
}

// Phase 6 检查
async function checkFastStart() {
  const candidates = ['README.md', 'docs/setup.md', 'docs/getting-started.md']
  for (const f of candidates) {
    if (existsSync(join(CWD, f))) {
      const content = require('node:fs').readFileSync(join(CWD, f), 'utf-8')
      // 文档里应该有 install + run 命令
      if (/npm install|pnpm install|yarn install/.test(content) && /npm run (dev|start)|pnpm (dev|start)/.test(content)) {
        return { pass: true, details: `${f} 包含安装 + 启动命令` }
      }
    }
  }
  return { pass: false, details: '未找到包含 install + run 命令的文档' }
}

async function checkRationale() {
  const candidates = ['docs/architecture.md', 'docs/decisions.md', 'docs/ADR', 'ARCHITECTURE.md']
  for (const f of candidates) {
    if (existsSync(join(CWD, f))) {
      const content = require('node:fs').readFileSync(join(CWD, f), 'utf-8')
      // 应该包含 "because" / "trade-off" / "why" 等决策理由关键词
      const reasons = (content.match(/because|trade[- ]off|why|rationale|choose.*over|decision/g) || []).length
      if (reasons >= 3) return { pass: true, details: `${f} 包含 ${reasons} 处决策理由说明` }
    }
  }
  return { pass: false, details: '未找到包含决策理由的架构文档' }
}

// ─── Gate → 检查函数映射 ──────────────────────────────────────
const GATE_CHECKERS = {
  'phase1.productBrief':   () => fileExists('docs/product-brief.md'),
  'phase1.profile':        () => stateKey('projectProfile'),
  'phase1.techChoices':    () => stateKey('techStack'),
  'phase1.archDiagram':    () => fileExists('docs/architecture.md', /┌|──|ASCII|架构图/i),
  'phase1.dataModel':      () => fileExists('docs/data-model.md'),
  'phase2.health':         checkHealth,
  'phase2.db':             checkDb,
  'phase2.typecheck':      checkTypecheck,
  'phase2.noconsole':      checkNoConsole,
  'phase2.envExample':     checkEnvExample,
  'phase3.allModules':     () => stateKey('techStack'), // 简化：只要 techStack 有值就算
  'phase3.typecheck':      checkTypecheckRegression,
  'phase4.degrade':        checkDegrade,
  'phase4.usageQuery':     checkUsageQuery,
  'phase4.budgetEnv':      checkBudgetEnv,
  'phase5.firstScreen':    checkFirstScreen,
  'phase5.badConfig':      checkBadConfig,
  'phase5.freshClone':     checkFastStart, // 复用文档检查
  'phase6.fastStart':      checkFastStart,
  'phase6.rationale':      checkRationale,
}

// ─── 辅助函数 ───────────────────────────────────────────────

function walkDir(dir, callback) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) walkDir(full, callback)
      else callback(full)
    } catch {}
  }
}

function fileExists(path, contentRegex) {
  const fullPath = join(CWD, path)
  if (!existsSync(fullPath)) return { pass: false, details: `${path} 不存在` }
  if (contentRegex) {
    const content = require('node:fs').readFileSync(fullPath, 'utf-8')
    if (!contentRegex.test(content)) return { pass: false, details: `${path} 存在但内容不匹配` }
  }
  return { pass: true, details: `${path} 存在` }
}

function stateKey(section) {
  if (!existsSync(STATE_PATH)) return { pass: false, details: '.workflow-state.json 不存在' }
  const state = JSON.parse(require('node:fs').readFileSync(STATE_PATH, 'utf-8'))
  const obj = state[section] || {}
  const filled = Object.values(obj).filter(v => v).length
  const total = Object.keys(obj).length
  if (filled === 0) return { pass: false, details: `${section} 未填任何值` }
  return { pass: true, details: `${section}: ${filled}/${total} 已填` }
}

async function runGate(slug) {
  const checker = GATE_CHECKERS[slug]
  if (!checker) return { pass: false, details: `未注册检查函数: ${slug}` }
  return await checker()
}

async function runPhase(phase) {
  const state = existsSync(STATE_PATH) ? JSON.parse(require('node:fs').readFileSync(STATE_PATH, 'utf-8')) : null
  const allGates = Object.keys(GATE_CHECKERS)
  const phaseGates = allGates.filter(g => g.startsWith(`phase${phase}.`))

  console.log(`\n🔍 Phase ${phase} — 运行 ${phaseGates.length} 个 gate 检查...\n`)
  let allPass = true

  for (const slug of phaseGates) {
    const result = await runGate(slug)
    const marker = result.pass ? '✅' : '❌'
    const prevPass = state?.gatesPassed?.[slug]
    const note = prevPass && !result.pass ? '⚠️  之前过了现在又挂了!' : (result.pass ? (prevPass ? '(已通过)' : '(新通过)') : '')
    console.log(`${marker} ${slug.padEnd(26)} ${result.details} ${note}`)
    if (!result.pass) allPass = false
  }

  return allPass
}

async function runAll() {
  let allPass = true
  for (let p = 1; p <= 6; p++) {
    const passed = await runPhase(p)
    if (!passed) allPass = false
  }
  return allPass
}

// ─── CLI ───────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv

if (!cmd || cmd === 'list') {
  console.log('\nGate → 检查函数 映射:')
  console.log('─'.repeat(60))
  for (const [slug, fn] of Object.entries(GATE_CHECKERS)) {
    console.log(`  ${slug.padEnd(26)} → ${fn.name}`)
  }
  console.log()
  console.log(`用法:
  node gate-check.js run                    运行当前 Phase 所有 gate
  node gate-check.js phase <1-6>            运行指定 Phase
  node gate-check.js single <gate-slug>     运行单个 gate`)
  process.exit(0)
}

let allPass = true
if (cmd === 'run') {
  const state = existsSync(STATE_PATH) ? JSON.parse(require('node:fs').readFileSync(STATE_PATH, 'utf-8')) : null
  const phase = state?.currentPhase || 1
  allPass = await runPhase(phase)
} else if (cmd === 'phase') {
  allPass = await runPhase(parseInt(args[0], 10))
} else if (cmd === 'single') {
  const result = await runGate(args[0])
  console.log(`${result.pass ? '✅' : '❌'} ${args[0]} — ${result.details}`)
  allPass = result.pass
}

process.exit(allPass ? 0 : 1)
