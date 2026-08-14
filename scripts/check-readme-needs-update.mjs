#!/usr/bin/env node
/**
 * scripts/check-readme-needs-update.mjs
 *
 * README 同步判断脚本 — 节省 token 核心：
 *   改代码前先跑：pnpm run check:readme
 *
 *   ✅ 无需更新 → exit 0：AI 直接跳过，不浪费 token 在 README 润色/重写
 *   ⚠️ 需要更新 → exit 1：打印哪些关键项变了（端口/脚本/子项目/端口…），
 *                  完成 README 更新后再跑本脚本，会自动把新指纹写入 .trae-configs/readme-sync-fingerprint.json
 *
 *   关键项（触发更新的信号）：
 *   - 根 package.json：scripts / pnpm.overrides / packageManager
 *   - apps/* / packages/* 的 package.json：name / version / scripts.dev（默认端口）
 *   - apps/ / packages/ 目录列表：新增或删除子项目
 *   - pnpm-workspace.yaml：workspace 定义
 *   - README.md：最后修改时间（用于防止「README 改了但指纹没更新」）
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const FINGERPRINT_DIR = join(ROOT, '.trae-configs')
const FINGERPRINT_FILE = join(FINGERPRINT_DIR, 'readme-sync-fingerprint.json')
const README_FILE = join(ROOT, 'README.md')

function hashOf(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex')
}

function safeReadJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function safeReadText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function listDirs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort()
}

function extractAppPackageSig(pkgPath) {
  const pkg = safeReadJson(pkgPath)
  if (!pkg) return null
  // 只抽与 README 相关字段：name/version，以及 scripts.dev 里的默认端口
  const devScript = (pkg.scripts && pkg.scripts.dev) || ''
  return JSON.stringify({
    name: pkg.name || null,
    version: pkg.version || null,
    devScript,
  })
}

function collectSignals() {
  const signals = {}

  // 1. 根 package.json
  const rootPkg = safeReadJson(join(ROOT, 'package.json')) || {}
  signals.rootPackage = JSON.stringify({
    packageManager: rootPkg.packageManager || null,
    scripts: rootPkg.scripts || {},
    overrides: rootPkg.pnpm ? rootPkg.pnpm.overrides : undefined,
  })

  // 2. pnpm-workspace.yaml
  signals.workspace = safeReadText(join(ROOT, 'pnpm-workspace.yaml'))

  // 3. apps/* 目录列表 + 每个子项目 package.json 签名
  const appsDirs = listDirs(join(ROOT, 'apps'))
  signals.appsDirs = JSON.stringify(appsDirs)
  for (const dirName of appsDirs) {
    const pkgPath = join(ROOT, 'apps', dirName, 'package.json')
    signals[`app:${dirName}`] = extractAppPackageSig(pkgPath) || 'null'
  }

  // 4. packages/* 同上
  const pkgsDirs = listDirs(join(ROOT, 'packages'))
  signals.packagesDirs = JSON.stringify(pkgsDirs)
  for (const dirName of pkgsDirs) {
    const pkgPath = join(ROOT, 'packages', dirName, 'package.json')
    signals[`pkg:${dirName}`] = extractAppPackageSig(pkgPath) || 'null'
  }

  // 5. README 最后修改时间（若人为更新了 README，指纹也应该前进）
  try {
    signals.readmeMtime = String(statSync(README_FILE).mtimeMs)
  } catch {
    signals.readmeMtime = '0'
  }

  const keys = Object.keys(signals).sort()
  const overall = []
  for (const k of keys) {
    overall.push(`${k}=${hashOf(String(signals[k]))}`)
  }
  const combined = overall.join('\n')
  return {
    signals,
    keys,
    perHash: Object.fromEntries(keys.map(k => [k, hashOf(String(signals[k]))])),
    overallHash: hashOf(combined),
  }
}

function main() {
  const args = new Set(process.argv.slice(2))
  const forceUpdate = args.has('--update') || args.has('-u')

  if (!existsSync(FINGERPRINT_DIR)) {
    mkdirSync(FINGERPRINT_DIR, { recursive: true })
  }

  const current = collectSignals()
  const saved = safeReadJson(FINGERPRINT_FILE)

  if (!saved || forceUpdate) {
    writeFileSync(
      FINGERPRINT_FILE,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          overallHash: current.overallHash,
          perHash: current.perHash,
          comment:
            'README 同步指纹 — 由 scripts/check-readme-needs-update.mjs 自动生成。请勿手动编辑。当关键项变化时，AI 需要更新 README 后再跑 pnpm run check:readme --update 刷新本文件。',
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )
    if (forceUpdate) {
      console.log('✅ README 指纹已强制更新。')
      process.exit(0)
    }
    console.log('✅ 初次生成 README 指纹。以后改动关键配置时，本脚本会告诉你是否需要同步 README。')
    process.exit(0)
  }

  // 对比：整体 hash 一致 → 直接 pass，零 token 消耗
  if (saved.overallHash === current.overallHash) {
    console.log('✅ README 无需更新（所有关键项签名一致，未浪费任何 token）。')
    process.exit(0)
  }

  // 不一致：打印差异项，精确告诉 AI 哪块变了（避免 AI 全文盲目重写）
  const changedKeys = []
  for (const k of current.keys) {
    if ((saved.perHash?.[k] || '') !== current.perHash[k]) {
      changedKeys.push(k)
    }
  }
  // 旧指纹里有但新没有的 key（例如子项目被删除）
  const oldKeys = Object.keys(saved.perHash || {})
  for (const k of oldKeys) {
    if (!current.perHash[k]) {
      changedKeys.push(k)
    }
  }

  console.error('⚠️  README 需要同步更新！以下关键项签名发生变化：')
  for (const k of changedKeys.sort()) {
    const descMap = {
      rootPackage: '根 package.json（scripts / overrides / packageManager）',
      workspace: 'pnpm-workspace.yaml（workspace 定义）',
      appsDirs: 'apps/ 子项目目录列表（新增/删除 app）',
      packagesDirs: 'packages/ 子包目录列表（新增/删除 package）',
      readmeMtime: 'README.md 本身修改时间',
    }
    let human = descMap[k]
    if (!human && k.startsWith('app:')) {
      human = `apps/${k.slice('app:'.length)}/package.json（name/version/dev 默认端口）`
    }
    if (!human && k.startsWith('pkg:')) {
      human = `packages/${k.slice('pkg:'.length)}/package.json（name/version/dev 默认端口）`
    }
    console.error(`  · ${human || k}`)
  }
  console.error('')
  console.error('👉 更新 README 后，运行：pnpm run check:readme --update 刷新指纹。')
  console.error('👉 或未改动结构，只需让指纹前进以跳过检查：pnpm run check:readme --update')
  process.exit(1)
}

main()
