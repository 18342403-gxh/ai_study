/**
 * Electron 主进程入口
 *
 * Phase 4 职责（第二批增强）：
 *   - Splash 启动页（独立窗口 + 进度更新 + 最小显示时间）
 *   - 桌面通知 Notification
 *   - 文件拖拽拦截（file:// URL → 转发到渲染进程）
 *
 * Phase 3 已实现：
 *   - 单实例锁
 *   - Tray + 原生菜单栏 + 全局快捷键
 *   - show:false + ready-to-show 消白屏
 *   - 窗口位置/大小持久化（零依赖 fs 实现）
 *   - 关闭时弹对话框（退出/最小化到托盘/取消）
 *   - 友好错误页
 *
 * 启动流程：
 *   ① app.whenReady → 立即创建 splash 窗口（480×320、无边框、居中）
 *   ② 开始 startEmbeddedServices，每步更新 splash 文案
 *   ③ 服务就绪 → createWindow()（show:false）
 *   ④ 主窗口 ready-to-show → destroy splash + show 主窗口
 */

import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  Notification,
  type NativeImage,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import { DESKTOP, SERVER } from '../shared/ipc-channels.js'
import { spawnServer } from './spawnServer.js'
import { spawnGenerator } from './spawnGenerator.js'
import { waitForPort, waitForJsonEndpoint } from './waitForPort.js'
import { gracefulShutdown } from './lifecycle.js'
import { applyBounds, bindAutoSave, saveBounds } from './windowState.js'

// ── 状态 ──────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let tray: Tray | null = null
let serverProc: ChildProcess | null = null
let generatorProc: ChildProcess | null = null
let serverUrl = process.env.SERVER_URL || 'http://localhost:3001'
let generatorUrl = process.env.GENERATOR_URL || 'http://localhost:3003'

const DEV_SKIP_SPAWN = process.env.DEV_SKIP_SPAWN === '1'

/**
 * 关键 flag：区分"用户点 X 关闭" vs "主动 app.quit()"
 * - 用户点 X →弹对话框询问
 * - 托盘"退出" / Cmd+Q / app.quit() → isQuitting = true，直接走 before-quit，不再弹
 */
let isQuitting = false

/** Splash 最小显示时间（ms），避免 DEV 模式一闪而过 */
const MIN_SPLASH_DISPLAY_MS = 500

// ── Splash 启动页 ─────────────────────────────────────

/** Splash HTML（内联 data:text/html，零额外文件） */
function getSplashHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%;width:100%;background:#1a1a2e;color:#eee;font-family:system-ui,-apple-system,sans-serif;overflow:hidden}
  .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:32px;text-align:center}
  .spinner{width:48px;height:48px;border:3px solid #2a2a4e;border-top-color:#6c5ce7;border-radius:50%;animation:spin 0.9s linear infinite;margin-bottom:24px}
  @keyframes spin{to{transform:rotate(360deg)}}
  h1{font-size:18px;margin-bottom:8px;font-weight:600;letter-spacing:0.5px}
  .status{font-size:13px;color:#888;min-height:20px;transition:color 0.2s}
  .status.done{color:#4ade80}
  .status.error{color:#f87171}
  .progress{width:200px;height:3px;background:#2a2a4e;border-radius:2px;margin-top:16px;overflow:hidden}
  .progress-fill{height:100%;background:linear-gradient(90deg,#6c5ce7,#a29bfe);border-radius:2px;transition:width 0.3s ease}
</style></head>
<body>
<div class="wrap">
  <div class="spinner"></div>
  <h1>AI 组件生成器</h1>
  <div class="status" id="status">正在初始化...</div>
  <div class="progress"><div class="progress-fill" id="bar" style="width:10%"></div></div>
</div>
<script>
  // 进度条更新（主进程通过 executeJavaScript 调 updateProgress）
  window.updateProgress = function(percent, msg) {
    const bar = document.getElementById('bar');
    const status = document.getElementById('status');
    if (bar) bar.style.width = percent + '%';
    if (status) {
      status.textContent = msg;
      status.className = 'status';
    }
  };
  window.splashDone = function(msg) {
    const bar = document.getElementById('bar');
    const status = document.getElementById('status');
    if (bar) bar.style.width = '100%';
    if (status) {
      status.textContent = msg || '启动完成';
      status.className = 'status done';
    }
  };
  window.splashError = function(msg) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = msg || '启动失败';
      status.className = 'status error';
    }
  };
</script>
</body></html>`
}

function createSplashWindow(): BrowserWindow {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true, // data URL 同步加载，直接 show 没问题
    backgroundColor: '#1a1a2e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 需要执行 executeJavaScript 注入的 window.updateProgress
    },
  })

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getSplashHtml())}`)

  // 禁止右键菜单、禁止新窗口
  splashWindow.setMenuBarVisibility(false)

  splashWindow.on('closed', () => {
    splashWindow = null
  })

  console.log('[electron] Splash 窗口已创建')
  return splashWindow
}

/** 通过 executeJavaScript 更新 splash 文案和进度条 */
function updateSplash(percent: number, msg: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return
  splashWindow.webContents
    .executeJavaScript(`window.updateProgress(${percent}, ${JSON.stringify(msg)})`)
    .catch(() => {
      /* splash 可能已关闭 */
    })
}

function finishSplash(msg = '启动完成'): void {
  if (!splashWindow || splashWindow.isDestroyed()) return
  splashWindow.webContents
    .executeJavaScript(`window.splashDone(${JSON.stringify(msg)})`)
    .catch(() => {})
}

function errorSplash(msg: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return
  splashWindow.webContents
    .executeJavaScript(`window.splashError(${JSON.stringify(msg)})`)
    .catch(() => {})
}

// ── 启动流程 ──────────────────────────────────────────

async function startEmbeddedServices(
  onProgress?: (percent: number, msg: string) => void,
): Promise<void> {
  const notify = (p: number, m: string) => {
    onProgress?.(p, m)
    updateSplash(p, m)
  }

  if (DEV_SKIP_SPAWN) {
    console.log('[electron] DEV_SKIP_SPAWN=1，跳过 spawn，连已手动启动的服务')
    notify(20, '正在连接 BFF 服务...')
    await waitForJsonEndpoint(serverUrl, '/api/health', { timeoutMs: 10_000 })
    notify(60, '正在连接前端服务...')
    await waitForPort(generatorUrl, { timeoutMs: 10_000 })
    notify(100, '服务就绪')
    return
  }

  // ① 启动 BFF
  notify(10, '启动后端服务...')
  console.log('[electron] 启动 server 子进程...')
  const srv = spawnServer()
  serverProc = srv.proc
  serverUrl = srv.url
  notify(30, '等待后端就绪...')
  await waitForJsonEndpoint(serverUrl, '/api/health', { timeoutMs: 30_000 })
  console.log(`[electron] server 就绪 → ${serverUrl}`)

  // ② 启动前端
  notify(60, '启动前端服务...')
  console.log('[electron] 启动 generator 子进程...')
  const gen = spawnGenerator({ serverPort: srv.port })
  generatorProc = gen.proc
  generatorUrl = gen.url
  notify(85, '等待前端就绪...')
  await waitForPort(generatorUrl, { path: '/', timeoutMs: 30_000 })
  console.log(`[electron] generator 就绪 → ${generatorUrl}`)
  notify(100, '服务就绪')
}

// ── Tray ────────────────────────────────────────────

function resolveTrayIcon(): NativeImage | undefined {
  const candidates = [
    path.join(__dirname, '../../../../assets/brand/tech_cat.png'),
    path.join(__dirname, '../../../assets/brand/tech_cat.png'),
  ]

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) return img
      }
    } catch {
      // try next
    }
  }

  return undefined
}

function createTray(): void {
  const icon = resolveTrayIcon()
  if (!icon) {
    console.warn('[electron] 未找到 tray 图标，跳过创建托盘')
    return
  }

  const trayIcon = icon.resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: '重启嵌入式服务',
      enabled: !DEV_SKIP_SPAWN,
      click: async () => {
        console.log('[electron] 重启服务 — Phase 3 实现')
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setToolTip('AI 组件生成器')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  console.log('[electron] 系统托盘已创建')
}

// ── 原生菜单栏 ────────────────────────────────────────

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),

    {
      label: '文件',
      submenu: [
        {
          label: '选择目录...',
          click: async () => {
            if (!mainWindow) return
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
            })
            if (!result.canceled && result.filePaths[0]) {
              console.log('[electron] 菜单选择目录:', result.filePaths[0])
            }
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          role: 'quit',
        },
      ],
    },

    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { type: 'separator' },
        { label: '开发者工具', role: 'toggleDevTools', accelerator: 'F12' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    {
      label: '帮助',
      submenu: [
        {
          label: '打开项目文档',
          click: () => shell.openExternal('https://github.com'),
        },
        {
          label: '关于 AI 组件生成器',
          role: 'about',
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  console.log('[electron] 原生菜单栏已创建')
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
    serverUrl,
    generatorUrl,
  }))

  ipcMain.handle(SERVER.SET_API_KEY, async (_evt, _key: string) => {
    return { ok: true, note: 'stub — Phase 3 实现' }
  })

  ipcMain.handle(SERVER.GET_STATUS, async () => ({
    serverUrl,
    generatorUrl,
    serverRunning: serverProc !== null && !serverProc.killed,
    generatorRunning: generatorProc !== null && !generatorProc.killed,
  }))

  /** 系统桌面通知 —— 从 electron 解构导入 Notification */
  ipcMain.handle(
    DESKTOP.SHOW_NOTIFICATION,
    async (_evt, options: { title: string; body?: string; silent?: boolean }) => {
      try {
        if (!Notification.isSupported()) return false
        const n = new Notification({
          title: options.title,
          body: options.body,
          silent: options.silent,
        })
        n.show()
        return true
      } catch (err) {
        console.error('[electron] 通知失败:', err)
        return false
      }
    },
  )

  /**
   * 文件拖拽事件转发：
   * preload 拦截 DOM drop → ipcRenderer.send(DESKTOP.FILE_DROPPED, paths)
   * 主进程收到 → mainWindow.webContents.send(DESKTOP.FILE_DROPPED, paths)
   * 渲染进程通过 window.desktop.onFileDropped(listener) 监听
   */
  ipcMain.on(DESKTOP.FILE_DROPPED, (_evt, filePaths: string[]) => {
    console.log('[electron] 文件拖拽 →', filePaths)
    mainWindow?.webContents.send(DESKTOP.FILE_DROPPED, filePaths)
  })
}

// ── 窗口创建 ──────────────────────────────────────────

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'AI 组件生成器',
    show: false, // ← 关键：先不显示，等 ready-to-show 再 show()，消除白屏
    backgroundColor: '#1a1a2e', // 深色底色，即使短暂显示也不会白屏刺眼
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  })

  // 恢复上次的窗口位置/大小
  applyBounds(mainWindow)
  bindAutoSave(mainWindow)

  // 加载 URL
  mainWindow.loadURL(generatorUrl)

  // 服务启动失败时加载错误页（而不是白屏）
  mainWindow.webContents.on('did-fail-load', (_evt, code, desc) => {
    console.error('[electron] 页面加载失败:', code, desc)
    mainWindow?.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(getErrorHtml(code, desc))}`,
    )
  })

  // 准备好显示了 —— show:false 的正确姿势
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    destroySplash() // 主窗口 show 后再销毁 splash，避免闪黑
  })

  // 自动打开 DevTools（默认关闭；AUTO_OPEN_DEBUG_PAGES=1 开启）
  if (process.env.AUTO_OPEN_DEBUG_PAGES === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // 窗口关闭事件 —— 核心拦截点
  mainWindow.on('close', async (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return

    // isQuitting = app.quit() 主动调用的 → 不拦截，直接走
    if (isQuitting) {
      saveBounds(mainWindow)
      return
    }

    // 统一弹对话框询问 —— 无论托盘是否存在
    event.preventDefault()
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '关闭确认',
      message: '要如何处理？',
      detail: '嵌入式服务会随退出而停止。',
      buttons: ['最小化到托盘', '退出程序', '取消'],
      defaultId: 0,
      noLink: true,
    })

    if (choice.response === 0) {
      // 最小化到托盘
      if (!tray) {
        createTray()
      }
      saveBounds(mainWindow)
      mainWindow.hide()
    } else if (choice.response === 1) {
      // 退出
      isQuitting = true
      app.quit()
    }
    // response === 2 → 取消，什么都不做
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

/** 销毁 splash 窗口（带最小显示时间保证） */
function destroySplash(): void {
  if (!splashWindow || splashWindow.isDestroyed()) return
  splashWindow.destroy()
  console.log('[electron] Splash 窗口已销毁')
}

/** 服务启动失败时展示的友好错误页 HTML */
function getErrorHtml(code: number, desc: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>启动失败</title>
<style>
  body{background:#1a1a2e;color:#eee;font-family:system-ui,sans-serif;
       display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
  .box{max-width:480px;padding:32px;text-align:center}
  h1{font-size:20px;margin:0 0 12px;color:#ff6b6b}
  p{font-size:14px;line-height:1.6;color:#aaa;margin:8px 0}
  code{background:#2a2a4e;padding:2px 6px;border-radius:4px;color:#ffd93d}
</style></head>
<body><div class="box">
  <h1>嵌入式服务未就绪</h1>
  <p>无法连接到 <code>${generatorUrl}</code></p>
  <p>错误码：<code>${code}</code></p>
  <p>${desc}</p>
  <p style="margin-top:24px">请确认 server 和 generator 服务是否正常启动，<br>或关闭本窗口手动排查。</p>
</div></body></html>`
}

// ── 全局快捷键 ────────────────────────────────────────

function registerGlobalShortcuts(): void {
  globalShortcut.register('F12', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools()
    }
  })

  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools()
    }
  })

  globalShortcut.register('CommandOrControl+R', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload()
    }
  })

  console.log('[electron] 全局快捷键已注册 (F12, Cmd/Ctrl+Shift+I, Cmd/Ctrl+R)')
}

function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
}

// ── Electron 生命周期 ──────────────────────────────────

app
  .whenReady()
  .then(async () => {
    // 单实例锁 —— 第二个实例进来时 focus 第一个
    const gotLock = app.requestSingleInstanceLock()
    if (!gotLock) {
      console.log('[electron] 已有实例在运行，退出')
      app.quit()
      return
    }

    // 第二个实例启动时，focus 第一个窗口
    app.on('second-instance', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow()
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })

    // ── 第一步：先创建 splash 窗口，让用户看到"正在启动..." ──
    const splashStart = Date.now()
    createSplashWindow()

    // ── 第二步：并行启动服务（带进度回调） ──
    let servicesOk = true
    try {
      await startEmbeddedServices()
    } catch (err) {
      servicesOk = false
      console.error('[electron] 嵌入式服务启动失败：', err)
      errorSplash('服务启动失败，正在打开错误页...')
    }

    // ── 第三步：确保 splash 至少显示 MIN_SPLASH_DISPLAY_MS ──
    const elapsed = Date.now() - splashStart
    const waitMore = Math.max(0, MIN_SPLASH_DISPLAY_MS - elapsed)
    if (waitMore > 0) {
      await new Promise((r) => setTimeout(r, waitMore))
    }

    // ── 第四步：创建主窗口（show:false） ──
    registerIpcHandlers()
    createTray()
    createMenu()
    registerGlobalShortcuts()

    if (servicesOk) {
      finishSplash('启动完成')
    }

    // createWindow 内部会在 ready-to-show 时 show + destroySplash
    createWindow()

    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    })
  })
  .catch((err) => {
    console.error('[electron] 初始化致命错误：', err)
  })

app.on('window-all-closed', async () => {
  console.log('[electron] window-all-closed，isQuitting=', isQuitting)
  await gracefulShutdown({ server: serverProc || undefined, generator: generatorProc || undefined })

  // 有托盘 → 不退出，保持 tray 运行
  if (tray && !isQuitting) {
    console.log('[electron] 托盘存在，保持运行不退出')
    return
  }

  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  console.log('[electron] before-quit，开始清理...')
  isQuitting = true
  unregisterGlobalShortcuts()
  // 确保 splash 也被销毁
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy()
  }
  await gracefulShutdown({ server: serverProc || undefined, generator: generatorProc || undefined })
})
