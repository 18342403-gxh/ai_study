/**
 * spawnServer — 启动 apps/server 作为子进程
 *
 * 双模式路径解析：
 *   DEV (NODE_ENV !== 'production')
 *     → __dirname 向上 4 层找 monorepo 根，用 pnpm exec tsx watch
 *   PROD (Electron 打包后)
 *     → process.resourcesPath/extraResources/server/ 下有打包好的 dist/
 *     → 直接 node dist/index.js（不再走 pnpm）
 *
 * 关键环境变量（Electron 注入）：
 *   PORT          — 默认 3001
 *   DB_PATH       — SQLite 数据库路径（桌面端用 userData 目录）
 *   DATABASE_DRIVER — postgres | sqlite
 *   AI_API_URL    — LLM API 地址
 *   AI_API_KEY    — LLM API Key（优先从用户 .env 读取）
 *   EMBEDDING_MODEL
 *   AI_MODEL
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

export interface SpawnOptions {
  cwd?: string
  env?: Record<string, string>
}

export interface ServerProc {
  proc: ChildProcess
  port: number
  url: string
}

/** 是否打包后的生产环境 */
function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * 定位 server 目录
 *   DEV:  dist/main/index.js → __dirname 向上 4 层 → apps/server
 *   PROD: resourcesPath/extraResources/server/（server/dist/ 已拷贝到这里）
 */
function resolveServerDir(): string {
  if (isProd() && process.resourcesPath) {
    const prodDir = path.join(process.resourcesPath, 'extraResources', 'server')
    // 检查是否存在 dist/index.js —— 不存在就 fallback 到 dev 逻辑（便于 prod 下调试）
    if (fs.existsSync(path.join(prodDir, 'dist', 'index.js'))) {
      return prodDir
    }
    console.warn(
      '[spawnServer] PROD 模式下未找到 resourcesPath/extraResources/server，fallback 到 dev 路径',
    )
  }
  // DEV fallback
  return path.resolve(__dirname, '../../../..', 'apps', 'server')
}

export function spawnServer(opts: SpawnOptions = {}): ServerProc {
  const port = parseInt(process.env.SERVER_PORT || '3001', 10)
  const serverDir = opts.cwd || resolveServerDir()

  // ── 构造环境变量 ──────────────────────────────────
  const userDataDir = app.getPath('userData')
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    // 桌面端 SQLite 放在 Electron userData 目录
    DB_PATH: path.join(userDataDir, 'knowledge.db'),
    DATABASE_DRIVER: 'sqlite',
    // PROD 不走 tsx，是编译好的 JS —— 不需要 tsx loader
    NODE_ENV: isProd() ? 'production' : 'development',
    // 读取 server 端 .env 文件（DEV 时在 serverDir 根目录找）
    ...(isProd() ? loadServerEnvIfFound() : loadServerEnv(path.join(serverDir, '.env'))),
    ...opts.env,
  }

  // ── 启动命令 ───────────────────────────────────────
  let command: string
  let args: string[]

  if (isProd()) {
    command = process.execPath // 用 Electron 内嵌的 Node
    args = [path.join(serverDir, 'dist', 'index.js')]
  } else {
    command = 'pnpm'
    args = ['exec', 'tsx', 'watch', 'src/index.ts']
  }

  const proc = spawn(command, args, {
    cwd: serverDir,
    env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // ── 日志转发（带前缀） ────────────────────────────
  const prefix = '[server]'
  proc.stdout.on('data', (d) => process.stdout.write(`${prefix} ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`${prefix} ${d}`))

  proc.on('exit', (code) => {
    console.log(`${prefix} exit code: ${code}`)
  })

  return { proc, port, url: `http://localhost:${port}` }
}

/**
 * PROD 模式：Electron 安装目录里没有 server/.env
 * 尝试读 userData 目录下的 .env 或用户手动指定的路径
 */
function loadServerEnvIfFound(): Record<string, string> {
  const results: Record<string, string> = {}

  // 1. userData/.env（用户可以在这里放 AI_API_KEY）
  const userDataEnv = path.join(app.getPath('userData'), '.env')
  if (fs.existsSync(userDataEnv)) {
    Object.assign(results, parseEnvFile(userDataEnv))
  }

  // 2. 用户显式指定的 env 文件
  const explicit = process.env.SERVER_ENV_FILE
  if (explicit && fs.existsSync(explicit)) {
    Object.assign(results, parseEnvFile(explicit))
  }

  return results
}

/** DEV 模式：从 serverDir/.env 读 AI_/EMBEDDING_/DATABASE_ 变量 */
function loadServerEnv(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {}
  const parsed = parseEnvFile(envPath)
  const filtered: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith('AI_') || k.startsWith('EMBEDDING') || k.startsWith('DATABASE_')) {
      filtered[k] = v
    }
  }
  return filtered
}

/** 纯解析 shell 格式 key=value */
function parseEnvFile(envPath: string): Record<string, string> {
  const result: Record<string, string> = {}
  const content = fs.readFileSync(envPath, 'utf-8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    result[key] = val
  }
  return result
}
