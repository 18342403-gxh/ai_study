/**
 * spawnGenerator — 启动 apps/generator（Nuxt 3）作为子进程
 *
 * 双模式路径解析：
 *   DEV → __dirname 向上 4 层找 monorepo 根，pnpm exec nuxi dev
 *   PROD → resourcesPath/extraResources/generator/.output/，node .output/server/index.mjs
 *
 * 关键：generator 的 Nuxt 需要知道 server 地址，通过 NUXT_PUBLIC_API_BASE 注入。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

export interface GeneratorProc {
  proc: ChildProcess
  port: number
  url: string
}

function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * 定位 generator 目录
 *   DEV: __dirname 向上 4 层 → apps/generator
 *   PROD: resourcesPath/extraResources/generator/（含 .output/）
 */
function resolveGeneratorDir(): string {
  if (isProd() && process.resourcesPath) {
    const prodDir = path.join(process.resourcesPath, 'extraResources', 'generator')
    if (fs.existsSync(path.join(prodDir, '.output', 'server', 'index.mjs'))) {
      return prodDir
    }
    console.warn(
      '[spawnGenerator] PROD 模式下未找到 .output/server/index.mjs，fallback 到 dev 路径',
    )
  }
  return path.resolve(__dirname, '../../../..', 'apps', 'generator')
}

export function spawnGenerator(opts: { serverPort?: number; cwd?: string } = {}): GeneratorProc {
  const port = parseInt(process.env.GENERATOR_PORT || '3003', 10)
  const serverPort = opts.serverPort || parseInt(process.env.SERVER_PORT || '3001', 10)
  const generatorDir = opts.cwd || resolveGeneratorDir()

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    // Nuxt 里 $fetch('/api/xxx') 默认走相对路径
    // SSR 时显式指定 BFF 地址
    NUXT_PUBLIC_API_BASE: `http://localhost:${serverPort}`,
    NODE_ENV: isProd() ? 'production' : 'development',
  }

  let command: string
  let args: string[]

  if (isProd()) {
    // Nitro SSR 产物可以直接 node .output/server/index.mjs 启动
    command = process.execPath
    args = [path.join(generatorDir, '.output', 'server', 'index.mjs')]
  } else {
    command = 'pnpm'
    args = ['exec', 'nuxi', 'dev', '--port', String(port)]
  }

  const proc = spawn(command, args, {
    cwd: generatorDir,
    env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const prefix = '[generator]'
  proc.stdout.on('data', (d) => process.stdout.write(`${prefix} ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`${prefix} ${d}`))

  proc.on('exit', (code) => {
    console.log(`${prefix} exit code: ${code}`)
  })

  return { proc, port, url: `http://localhost:${port}` }
}
