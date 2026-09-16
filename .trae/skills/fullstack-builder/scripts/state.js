#!/usr/bin/env node
/**
 * Workflow State Manager
 * 零依赖 Node.js 脚本。管理 .workflow-state.json 的所有操作。
 *
 * 用法:
 *   node state.js init <project-name>          创建初始状态文件
 *   node state.js show                          显示当前状态（gate 进度）
 *   node state.js pass <gate-slug>              标记一个 gate 通过
 *   node state.js check <gate-slug>             检查一个 gate 是否通过（exit 0=过, exit 1=没过）
 *   node state.js goto <phase-number>           跳到指定 phase（重置后续 gate）
 *   node state.js set <key> <value>             设置 projectProfile / techStack 的值
 *   node state.js reset                         删除状态文件
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_PATH = join(process.cwd(), '.workflow-state.json')

// Gate 定义：phase -> gates（slug + 描述）
const PHASE_GATES = {
  1: [
    { slug: 'phase1.productBrief',   desc: 'Product Brief 写好了' },
    { slug: 'phase1.profile',        desc: 'Project Profile 填满' },
    { slug: 'phase1.techChoices',    desc: '每个 tech choice 有 justification' },
    { slug: 'phase1.archDiagram',    desc: '架构图画了' },
    { slug: 'phase1.dataModel',      desc: '数据模型列了' },
  ],
  2: [
    { slug: 'phase2.health',         desc: 'Server 能启动 + /health 返回 200' },
    { slug: 'phase2.db',             desc: 'DB 表自动创建' },
    { slug: 'phase2.typecheck',      desc: 'Type 检查零错误' },
    { slug: 'phase2.noconsole',      desc: '零 console.log / print' },
    { slug: 'phase2.envExample',     desc: '.env.example 存在' },
  ],
  3: [
    { slug: 'phase3.allModules',     desc: '所有计划模块已完成' },
    { slug: 'phase3.typecheck',      desc: 'Type 检查零错误（回归）' },
  ],
  4: [
    { slug: 'phase4.degrade',        desc: '禁用 API key 仍能启动' },
    { slug: 'phase4.usageQuery',     desc: 'Usage 查询有数据' },
    { slug: 'phase4.budgetEnv',      desc: '预算阈值在 .env.example' },
  ],
  5: [
    { slug: 'phase5.firstScreen',    desc: '首屏不空' },
    { slug: 'phase5.badConfig',      desc: '无效配置不崩' },
    { slug: 'phase5.freshClone',     desc: 'Fresh clone 能跑' },
  ],
  6: [
    { slug: 'phase6.fastStart',      desc: '新开发者 10 分钟内跑起来' },
    { slug: 'phase6.rationale',      desc: '每个为什么有答案' },
  ],
}

function readState() {
  if (!existsSync(STATE_PATH)) {
    console.error(`❌ 状态文件不存在: ${STATE_PATH}`)
    console.error('   先运行: node state.js init <project-name>')
    process.exit(1)
  }
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
}

function writeState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8')
}

function init(projectName) {
  if (existsSync(STATE_PATH)) {
    console.log(`⚠️  状态文件已存在，备份到 ${STATE_PATH}.bak`)
    writeFileSync(STATE_PATH + '.bak', readFileSync(STATE_PATH, 'utf-8'))
  }
  const state = {
    project: projectName,
    currentPhase: 1,
    startedAt: new Date().toISOString(),
    gatesPassed: {},
    projectProfile: {
      size: 'startup-mvp', team: 'solo', deployment: 'single-vps', aiScale: 'low', frontendScope: 'spa',
    },
    techStack: {
      backend: 'express', frontend: 'vite+vue', database: 'sqlite', vectorStore: 'sqlite-cosine', layout: 'monorepo-noshared',
    },
    phaseHistory: [],
  }
  writeState(state)
  console.log(`✅ 初始化完成: ${STATE_PATH}`)
  console.log(`   项目: ${projectName}`)
  console.log(`   当前 Phase: 1 — Discovery & Design`)
  console.log(`\n   默认栈: Node(Express) + Vue + SQLite + Monorepo`)
  console.log(`   如需修改: node state.js set techStack.backend fastify`)
  console.log(`\n下一步: 运行 node state.js show 查看 Phase 1 需要过的 gate`)
}

function show() {
  const state = readState()
  const totalGates = Object.values(PHASE_GATES).flat().length

  console.log(`\n📊 Workflow: ${state.project}`)
  console.log(`   Phase ${state.currentPhase}/6  —  ${getPhaseName(state.currentPhase)}`)
  console.log(`   启动于: ${state.startedAt}`)
  console.log()

  for (let p = 1; p <= 6; p++) {
    const gates = PHASE_GATES[p]
    const passed = gates.filter(g => state.gatesPassed[g.slug]).length
    const phaseIcon = p < state.currentPhase ? '✅' : p === state.currentPhase ? '🔄' : '⏳'
    console.log(`${phaseIcon} Phase ${p} — ${getPhaseName(p)}  [${passed}/${gates.length}]`)

    for (const g of gates) {
      const mark = state.gatesPassed[g.slug] ? '  ✅' : (p === state.currentPhase ? '  ⬜' : '  ⬜')
      console.log(`   ${mark} ${g.slug.padEnd(22)} ${g.desc}`)
    }
    console.log()
  }

  // Profile + Stack 摘要
  const filledProfile = Object.entries(state.projectProfile).filter(([, v]) => v)
  const filledStack = Object.entries(state.techStack).filter(([, v]) => v)
  if (filledProfile.length || filledStack.length) {
    console.log('📋 Profile:', filledProfile.map(([k,v]) => `${k}=${v}`).join(', ') || '(未填)')
    console.log('🧱 Stack:', filledStack.map(([k,v]) => `${k}=${v}`).join(', ') || '(未选)')
  }
}

function pass(slug) {
  const state = readState()
  const allGates = Object.values(PHASE_GATES).flat()
  const gate = allGates.find(g => g.slug === slug)
  if (!gate) {
    console.error(`❌ 未知 gate: ${slug}`)
    console.error('   运行 node state.js show 查看所有可用 gate')
    process.exit(1)
  }
  state.gatesPassed[slug] = true
  writeState(state)
  console.log(`✅ ${slug} — 通过`)

  // 自动推进 phase
  const currentPhaseGates = PHASE_GATES[state.currentPhase]
  const allPassed = currentPhaseGates.every(g => state.gatesPassed[g.slug])
  if (allPassed && state.currentPhase < 6) {
    state.phaseHistory.push({
      phase: state.currentPhase,
      finishedAt: new Date().toISOString(),
      gatesPassed: currentPhaseGates.length,
    })
    state.currentPhase++
    writeState(state)
    console.log(`🎉 Phase ${state.currentPhase - 1} 全部通过！自动进入 Phase ${state.currentPhase} — ${getPhaseName(state.currentPhase)}`)
  } else if (allPassed && state.currentPhase === 6) {
    console.log('🏆 全部 6 个 Phase 完成！WORKFLOW COMPLETE')
  }
}

function check(slug) {
  const state = readState()
  if (state.gatesPassed[slug]) {
    console.log(`✅ ${slug} — 已通过`)
    process.exit(0)
  } else {
    console.log(`❌ ${slug} — 未通过`)
    process.exit(1)
  }
}

function goto(phase) {
  const p = parseInt(phase, 10)
  if (p < 1 || p > 6) {
    console.error(`❌ Phase 必须是 1-6`)
    process.exit(1)
  }
  const state = readState()
  // 重置目标 phase 及其后的所有 gates
  for (let i = p; i <= 6; i++) {
    for (const g of PHASE_GATES[i]) delete state.gatesPassed[g.slug]
  }
  state.currentPhase = p
  writeState(state)
  console.log(`⏩ 跳到 Phase ${p} — ${getPhaseName(p)}（后续 gate 已重置）`)
}

function set(key, value) {
  const state = readState()
  // 支持点号路径: projectProfile.size / techStack.backend
  if (key.includes('.')) {
    const [section, field] = key.split('.')
    if (state[section] && field in state[section]) {
      state[section][field] = value
      writeState(state)
      console.log(`✅ ${key} = ${value}`)
      return
    }
  }
  console.error(`❌ 无效 key: ${key}`)
  console.error('   可用: projectProfile.size|team|deployment|aiScale|frontendScope')
  console.error('         techStack.backend|frontend|database|vectorStore|layout')
  process.exit(1)
}

function reset() {
  if (existsSync(STATE_PATH)) {
    const path = require('node:path')
    try { require('node:fs').unlinkSync(STATE_PATH) } catch {}
    console.log(`🗑️  已删除 ${STATE_PATH}`)
  } else {
    console.log('状态文件不存在')
  }
}

function getPhaseName(p) {
  return {
    1: 'Discovery & Design',
    2: 'Scaffolding',
    3: 'Core Features',
    4: 'Cross-Cutting Concerns',
    5: 'Productization',
    6: 'Documentation & Handoff',
  }[p] || 'Unknown'
}

// CLI dispatch
const [, , cmd, ...args] = process.argv

if (!cmd) {
  console.log(`
Fullstack Builder — Workflow State Manager

用法:
  node state.js init <project-name>    创建 .workflow-state.json
  node state.js show                    显示所有 phase + gate 进度
  node state.js pass <gate-slug>        标记 gate 通过（自动推进 phase）
  node state.js check <gate-slug>       检查 gate 状态（exit 0/1）
  node state.js goto <1-6>              跳到指定 phase（重置后续 gate）
  node state.js set <key> <value>       设置 profile/stack 值
  node state.js reset                   删除状态文件
`)
  process.exit(0)
}

const handlers = { init, show, pass, check, goto, set, reset }
if (!handlers[cmd]) {
  console.error(`❌ 未知命令: ${cmd}`)
  process.exit(1)
}

handlers[cmd](...args)
