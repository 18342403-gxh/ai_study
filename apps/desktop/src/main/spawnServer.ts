/**
 * spawnServer — 启动 apps/server 作为子进程
 *
 * dev 模式：pnpm exec tsx watch src/index.ts（带热重载）
 * prod 模式：node dist/index.js
 *
 * 关键环境变量（Electron 注入）：
 *   PORT          — 默认 3001
 *   DB_PATH       — SQLite 数据库路径（桌面端用 userData 目录）
 *   DATABASE_DRIVER — postgres | sqlite
 *   AI_API_URL    — LLM API 地址
 *   AI_API_KEY    — LLM API Key（优先从用户 .env 读取；Phase 3 实现加密存储）
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

/** 项目根目录（从 apps/desktop/src/main → 向上 4 层） */
function resolveProjectRoot(): string {
  // esbuild bundle 后 __dirname = dist/main/
  // 向上 4 层 → 项目根
  return path.resolve(__dirname, '../../../..')
}

export function spawnServer(opts: SpawnOptions = {}): ServerProc {
  const port = parseInt(process.env.SERVER_PORT || '3001', 10)
  const isDev = process.env.NODE_ENV !== 'production'
  const projectRoot = opts.cwd || resolveProjectRoot()
  const serverDir = path.join(projectRoot, 'apps/server')

  // ── 构造环境变量 ──────────────────────────────────
  const userDataDir = app.getPath('userData')
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    // 桌面端 SQLite 放在 Electron userData 目录
    DB_PATH: path.join(userDataDir, 'knowledge.db'),
    // 读取 server 端 .env（如果存在）— 包含 AI_API_KEY 等
    ...loadServerEnv(serverDir),
    // 覆盖注入的值（优先级最高）
    ...opts.env,
  }

  // ── 启动命令 ───────────────────────────────────────
  const [command, args] = isDev
    ? ['pnpm', ['exec', 'tsx', 'watch', 'src/index.ts']]
    : ['node', ['dist/index.js']]

  const proc = spawn(command, args, {
    cwd: serverDir,
    env,
    shell: process.platform === 'win32',  // Windows 必须 shell: true
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

/** 读取 apps/server/.env 文件（纯解析 shell 格式 key=value） */
function loadServerEnv(serverDir: string): Record<string, string> {
  const envPath = path.join(serverDir, '.env')
  if (!fs.existsSync(envPath)) return {}

  const result: Record<string, string> = {}
  const content = fs.readFileSync(envPath, 'utf-8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    // 去掉引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    // 只保留 AI 相关的敏感 env，避免覆盖 Electron 自身的
    if (key.startsWith('AI_') || key.startsWith('EMBEDDING') || key.startsWith('DATABASE_')) {
      result[key] = val
    }
  }
  return result
}
