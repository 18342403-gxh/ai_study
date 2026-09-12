/**
 * Electron 主进程入口
 *
 * Phase 1 职责（最小壳）：
 *   1. 创建 BrowserWindow
 *   2. 加载已运行的 generator（http://localhost:3003）
 *   3. 不 spawn server / generator（那是 Phase 2 的事）
 *
 * Phase 2 才会加入：
 *   - spawnServer()    → fork apps/server 子进程
 *   - spawnGenerator() → fork apps/generator 子进程
 *   - 等待端口就绪再创建窗口
 */

import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import path from 'node:path'
import { DESKTOP, SERVER } from '../shared/ipc-channels.js'

// esbuild --format=cjs bundle 后 __dirname 自动可用（Node CJS 原生支持）

// ── 配置 ──────────────────────────────────────────────
const GENERATOR_URL = process.env.GENERATOR_URL || 'http://localhost:3003'
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001'

let mainWindow: BrowserWindow | null = null

// ── IPC Handlers（Phase 1：桩实现；Phase 3 补完整） ────

function registerIpcHandlers() {
  // desktop:chooseDirectory — Phase 3 实现
  ipcMain.handle(DESKTOP.CHOOSE_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // desktop:saveFile — Phase 3 实现
  ipcMain.handle(DESKTOP.SAVE_FILE, async (_evt, filename: string, content: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: filename })
    if (result.canceled || !result.filePath) return false
    // 用 Node fs 写入（主进程可以用 Node API）
    const fs = await import('node:fs/promises')
    await fs.writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  })

  // desktop:openExternal
  ipcMain.handle(DESKTOP.OPEN_EXTERNAL, async (_evt, url: string) => {
    await shell.openExternal(url)
    return true
  })

  // desktop:getAppInfo
  ipcMain.handle(DESKTOP.GET_APP_INFO, async () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData'),
  }))

  // server:setApiKey — Phase 3 实现（写 .env + 重启 server 子进程）
  ipcMain.handle(SERVER.SET_API_KEY, async (_evt, _key: string) => {
    // TODO (Phase 3): 写入 app.getPath('userData')/.env + 通知 server 子进程重载
    return { ok: true, note: 'stub — Phase 3 实现' }
  })

  // server:getStatus — Phase 2 实现
  ipcMain.handle(SERVER.GET_STATUS, async () => ({
    serverUrl: SERVER_URL,
    generatorUrl: GENERATOR_URL,
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
      // 🔒 安全三原则
      contextIsolation: true,          // ✅ 渲染进程和 Electron API 完全隔离
      nodeIntegration: false,           // ✅ 渲染进程不能 require('electron')
      sandbox: false,                   // preload 需要 Node API，所以不能开 sandbox
      preload: path.join(__dirname, '../preload/index.js'),
    },
  })

  // 渲染进程里的 target="_blank" 链接 → 系统默认浏览器打开，不在 Electron 内开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.loadURL(GENERATOR_URL)

  // 开发期可选：打开 DevTools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── Electron 生命周期 ──────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    // macOS 点 Dock 图标时重新创建窗口
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Phase 2 才需要优雅退出子进程
  // Phase 1 直接退出（子进程由用户手动管理）
  if (process.platform !== 'darwin') app.quit()
})

// 防崩：渲染进程崩溃不影响主进程
app.on('render-process-gone', (_evt, _wc, details) => {
  console.error('[electron] renderer process gone:', details.reason)
})
