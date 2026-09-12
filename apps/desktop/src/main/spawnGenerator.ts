/**
 * spawnGenerator — 启动 apps/generator（Nuxt 3）作为子进程
 *
 * dev 模式：pnpm exec nuxi dev --port 3003
 * prod 模式：先 build，然后 nuxi preview（或直接加载 build 产物）
 *
 * 关键：generator 的 Nuxt 需要知道 server 地址，通过 API_BASE_URL 注入。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'

export interface GeneratorProc {
  proc: ChildProcess
  port: number
  url: string
}

function resolveProjectRoot(): string {
  return path.resolve(__dirname, '../../../..')
}

export function spawnGenerator(opts: { serverPort?: number; cwd?: string } = {}): GeneratorProc {
  const port = parseInt(process.env.GENERATOR_PORT || '3003', 10)
  const serverPort = opts.serverPort || parseInt(process.env.SERVER_PORT || '3001', 10)
  const isDev = process.env.NODE_ENV !== 'production'
  const projectRoot = opts.cwd || resolveProjectRoot()
  const generatorDir = path.join(projectRoot, 'apps/generator')

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    // Nuxt 里 $fetch('/api/xxx') 默认走相对路径
    // 如果需要显式指定 BFF 地址（SSR 时），用 NUXT_PUBLIC_API_BASE
    NUXT_PUBLIC_API_BASE: `http://localhost:${serverPort}`,
  }

  const [command, args] = isDev
    ? ['pnpm', ['exec', 'nuxi', 'dev', '--port', String(port)]]
    : ['pnpm', ['exec', 'nuxi', 'preview', '--port', String(port)]]

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
