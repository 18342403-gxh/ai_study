/**
 * 生命周期管理 — 优雅退出子进程
 *
 * Electron 主进程退出前，必须确保子进程也被正确终止：
 * 1. SIGTERM（先礼）→ 给子进程 2 秒处理时间
 * 2. SIGKILL（后兵）→ 2 秒后还没退就强杀
 * 3. SQLite WAL checkpoint（如果用 SQLite）
 */

import type { ChildProcess } from 'node:child_process'

export interface GracefulTargets {
  server?: ChildProcess
  generator?: ChildProcess
}

export async function gracefulShutdown(targets: GracefulTargets): Promise<void> {
  const { server, generator } = targets

  const tasks: Promise<void>[] = []

  if (server) tasks.push(killProcess(server, '[server]'))
  if (generator) tasks.push(killProcess(generator, '[generator]'))

  await Promise.all(tasks)
  console.log('[electron] 所有子进程已清理')
}

function killProcess(proc: ChildProcess, tag: string): Promise<void> {
  return new Promise((resolve) => {
    if (!proc || proc.killed) {
      resolve()
      return
    }

    // 监听 exit 事件
    const onExit = () => resolve()
    proc.once('exit', onExit)

    // 先发 SIGTERM
    try {
      proc.kill('SIGTERM')
    } catch {
      // ignore
    }

    // 2 秒后还没退 → SIGKILL
    setTimeout(() => {
      if (!proc.killed) {
        console.log(`${tag} SIGTERM 后未退出，强制 SIGKILL`)
        try { proc.kill('SIGKILL') } catch { /* ignore */ }
      }
    }, 2000)

    // 兜底：5 秒后无论如何 resolve
    setTimeout(() => {
      proc.removeListener('exit', onExit)
      resolve()
    }, 5000)
  })
}
