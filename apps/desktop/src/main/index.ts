/**
 * Electron 主进程入口
 *
 * Phase 2 职责（内嵌 BFF + 内嵌前端）：
 *   1. spawn server（apps/server 子进程，DB_PATH 指向 userData 目录）
 *   2. 等待 server /api/health 就绪
 *   3. spawn generator（apps/generator 子进程）
 *   4. 等待 generator 端口就绪
 *   5. 创建 BrowserWindow，loadURL generator
 *   6. 退出时优雅终止子进程（SIGTERM → 2s → SIGKILL）
 *
 * 开发期提示：
 *   DEV_SKIP_SPAWN=1 可跳过 spawn，直接连已手动启动的 server + generator
 *   （方便调试：手动改代码看热重载，不用每次重启 Electron）
 */

import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { DESKTOP, SERVER } from '../shared/ipc-channels.js'
import { spawnServer } from './spawnServer.js'
import { spawnGenerator } from './spawnGenerator.js'
import { waitForPort, waitForJsonEndpoint } from './waitForPort.js'
import { gracefulShutdown } from './lifecycle.js'

// ── 状态 ──────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let serverProc: ChildProcess | null = null
let generatorProc: ChildProcess | null = null
let serverUrl = process.env.SERVER_URL || 'http://localhost:3001'
let generatorUrl = process.env.GENERATOR_URL || 'http://localhost:3003'

const DEV_SKIP_SPAWN = process.env.DEV_SKIP_SPAWN === '1'

// ── 启动流程 ──────────────────────────────────────────

async function startEmbeddedServices(): Promise<void> {
  if (DEV_SKIP_SPAWN) {
    console.log('[electron] DEV_SKIP_SPAWN=1，跳过 spawn，连已手动启动的服务')
    // 还是要等端口就绪
    await waitForJsonEndpoint(serverUrl, '/api/health', { timeoutMs: 10_000 })
    await waitForPort(generatorUrl, { timeoutMs: 10_000 })
    return
  }

  // ① 启动 BFF
  console.log('[electron] 启动 server 子进程...')
  const srv = spawnServer()
  serverProc = srv.proc
  serverUrl = srv.url
  await waitForJsonEndpoint(serverUrl, '/api/health', { timeoutMs: 30_000 })
  console.log(`[electron] server 就绪 → ${serverUrl}`)

  // ② 启动前端
  console.log('[electron] 启动 generator 子进程...')
  const gen = spawnGenerator({ serverPort: srv.port })
  generatorProc = gen.proc
  generatorUrl = gen.url
  await waitForPort(generatorUrl, { path: '/', timeoutMs: 30_000 })
  console.log(`[electron] generator 就绪 → ${generatorUrl}`)
}

// ── IPC Handlers ──────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle(DESKTOP.CHOOSE_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(DESKTOP.SAVE_FILE, async (_evt, filename: string, content: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: filename })
    if (result.canceled || !result.filePath) return false
    const fs = await import('node:fs/promises')
    await fs.writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  })

  ipcMain.handle(DESKTOP.OPEN_EXTERNAL, async (_evt, url: string) => {
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle(DESKTOP.GET_APP_INFO, async () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData'),
    // 附加嵌入式服务信息
    serverUrl,
    generatorUrl,
  }))

  ipcMain.handle(SERVER.SET_API_KEY, async (_evt, _key: string) => {
    // TODO (Phase 3): 写入 userData/.env + 通知 server 子进程重启
    return { ok: true, note: 'stub — Phase 3 实现' }
  })

  ipcMain.handle(SERVER.GET_STATUS, async () => ({
    serverUrl,
    generatorUrl,
    serverRunning: serverProc !== null && !serverProc.killed,
    generatorRunning: generatorProc !== null && !generatorProc.killed,
  }))
}

// ── 窗口创建 ──────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'AI 组件生成器',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.loadURL(generatorUrl)

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── Electron 生命周期 ──────────────────────────────────

app.whenReady()
  .then(async () => {
    try {
      await startEmbeddedServices()
    } catch (err) {
      console.error('[electron] 嵌入式服务启动失败：', err)
      // 失败也继续创建窗口，用户可以看到错误页面并手动诊断
    }

    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((err) => {
    console.error('[electron] 初始化致命错误：', err)
  })

app.on('window-all-closed', async () => {
  console.log('[electron] window-all-closed，开始优雅退出...')
  await gracefulShutdown({ server: serverProc || undefined, generator: generatorProc || undefined })
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  // 在 macOS 上 quit 时也要清理
  await gracefulShutdown({ server: serverProc || undefined, generator: generatorProc || undefined })
})

app.on('render-process-gone', (_evt, _wc, details) => {
  console.error('[electron] renderer process gone:', details.reason)
})
