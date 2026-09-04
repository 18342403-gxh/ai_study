#!/usr/bin/env node
/**
 * 前端工作流状态管理
 *
 * 用法：
 *   node workflow-state.mjs init <module-name>   # 初始化新模块，状态重置为 design
 *   node workflow-state.mjs next                  # 推进到下一阶段（用户确认后调用）
 *   node workflow-state.mjs current               # 查看当前状态
 *   node workflow-state.mjs back <phase>          # 回到指定阶段（如 back design / back code）
 *
 * 状态文件：.trae/workflow-state.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '../../..')
const STATE_DIR = resolve(PROJECT_ROOT, '.trae')
const STATE_FILE = resolve(STATE_DIR, 'workflow-state.json')

const PHASES = ['design', 'code', 'verify', 'teach']
const PHASE_LABELS = {
  design: '① 方案',
  code: '② 代码',
  verify: '③ 验证',
  teach: '④ 讲解',
}

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
}

function loadState() {
  if (!existsSync(STATE_FILE)) return null
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
  } catch {
    return null
  }
}

function saveState(state) {
  ensureStateDir()
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

function now() {
  return new Date().toISOString()
}

// ── Commands ──

function init(moduleName) {
  if (!moduleName) {
    console.error('❌ 请提供模块名: init <module-name>')
    process.exit(1)
  }

  const state = {
    currentModule: moduleName,
    currentPhase: 'design',
    startedAt: now(),
    history: [
      { module: moduleName, phase: 'design', action: 'init', timestamp: now() },
    ],
  }

  saveState(state)
  console.log('╔══════════════════════════════════════╗')
  console.log('║  🚀 工作流初始化完成                   ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`  模块: ${moduleName}`)
  console.log(`  阶段: ${PHASE_LABELS[state.currentPhase]}`)
  console.log(`  开始: ${state.startedAt}`)
  console.log('')
  console.log('  执行 Phase ① 方案...')
}

function next() {
  const state = loadState()
  if (!state) {
    console.error('❌ 没有活跃的工作流。先运行: init <module-name>')
    process.exit(1)
  }

  const idx = PHASES.indexOf(state.currentPhase)
  if (idx >= PHASES.length - 1) {
    console.log('🎉 模块已全部完成！可以开始新模块: init <module-name>')
    return
  }

  const prev = state.currentPhase
  state.currentPhase = PHASES[idx + 1]
  state.history.push({
    module: state.currentModule,
    phase: state.currentPhase,
    action: 'next',
    from: prev,
    timestamp: now(),
  })
  state.startedAt = state.startedAt // keep original

  saveState(state)
  console.log(`✅ 阶段推进: ${PHASE_LABELS[prev]} → ${PHASE_LABELS[state.currentPhase]}`)
}

function back(targetPhase) {
  const state = loadState()
  if (!state) {
    console.error('❌ 没有活跃的工作流')
    process.exit(1)
  }
  if (!PHASES.includes(targetPhase)) {
    console.error(`❌ 无效阶段: ${targetPhase}。可选: ${PHASES.join(', ')}`)
    process.exit(1)
  }

  const prev = state.currentPhase
  state.currentPhase = targetPhase
  state.history.push({
    module: state.currentModule,
    phase: targetPhase,
    action: 'back',
    from: prev,
    timestamp: now(),
  })

  saveState(state)
  console.log(`↩️ 阶段回退: ${PHASE_LABELS[prev]} → ${PHASE_LABELS[targetPhase]}`)
}

function current() {
  const state = loadState()
  if (!state) {
    console.log('📭 没有活跃的工作流')
    return
  }

  console.log('╔══════════════════════════════════════╗')
  console.log('║  📊 当前工作流状态                     ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`  模块: ${state.currentModule}`)
  console.log(`  阶段: ${PHASE_LABELS[state.currentPhase]}`)
  console.log(`  开始: ${state.startedAt}`)
  console.log('')
  console.log('  进度:')
  for (const p of PHASES) {
    const doneIdx = PHASES.indexOf(state.currentPhase)
    const pIdx = PHASES.indexOf(p)
    const icon = pIdx < doneIdx ? '✅' : pIdx === doneIdx ? '▶️' : '⬜'
    console.log(`    ${icon} ${PHASE_LABELS[p]}`)
  }
  console.log('')
  if (state.history.length > 0) {
    console.log('  历史记录:')
    for (const h of state.history) {
      const time = h.timestamp.slice(11, 19)
      if (h.action === 'init') console.log(`    [${time}] 🚀 init ${h.module} @ ${PHASE_LABELS[h.phase]}`)
      else if (h.action === 'next') console.log(`    [${time}] ➡️ ${PHASE_LABELS[h.from]} → ${PHASE_LABELS[h.phase]}`)
      else if (h.action === 'back') console.log(`    [${time}] ⬅️ ${PHASE_LABELS[h.from]} ← ${PHASE_LABELS[h.phase]}`)
    }
  }
}

// ── Dispatch ──
const args = process.argv.slice(2)
const cmd = args[0]
const arg1 = args[1]

switch (cmd) {
  case 'init':    init(arg1); break
  case 'next':    next(); break
  case 'back':    back(arg1); break
  case 'current':
  case 'status':
  case undefined: current(); break
  default:
    console.log(`用法:`)
    console.log(`  node workflow-state.mjs init <module-name>   初始化新模块`)
    console.log(`  node workflow-state.mjs next                  推进到下一阶段`)
    console.log(`  node workflow-state.mjs current                查看当前状态`)
    console.log(`  node workflow-state.mjs back <phase>           回到指定阶段`)
    console.log(`  可选阶段: ${PHASES.join(', ')}`)
    process.exit(1)
}
