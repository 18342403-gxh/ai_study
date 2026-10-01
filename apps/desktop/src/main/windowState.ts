/**
 * windowState — 窗口位置/大小持久化
 *
 * 目标：Electron 重启后恢复上次的窗口位置和大小，
 *       用户手动调整后自动保存。
 *
 * 零依赖实现：用 app.getPath('userData') + fs 读写 JSON 文件，
 * 文件路径 = <userData>/window-state.json
 */

import { app, screen } from 'electron'
import type { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface Bounds {
  x: number
  y: number
  width: number
  height: number
  maximized?: boolean
}

const FILE_PATH = path.join(app.getPath('userData'), 'window-state.json')

/** 确保 userData 目录存在 */
function ensureDir(): void {
  const dir = path.dirname(FILE_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** 读取上次保存的窗口 bounds */
export function loadBounds(): Bounds | undefined {
  try {
    if (!fs.existsSync(FILE_PATH)) return undefined
    const raw = fs.readFileSync(FILE_PATH, 'utf-8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && 'width' in data && 'height' in data) {
      return data as Bounds
    }
    return undefined
  } catch (err) {
    console.warn('[electron] 读取 window-state.json 失败，忽略:', err)
    return undefined
  }
}

/** 保存当前窗口 bounds（resize 结束 + close 时调用） */
export function saveBounds(win: BrowserWindow): void {
  if (!win || win.isDestroyed()) return

  const bounds = win.getBounds()
  const maximized = win.isMaximized()

  try {
    ensureDir()
    fs.writeFileSync(
      FILE_PATH,
      JSON.stringify(
        {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          maximized,
        } satisfies Bounds,
        null,
        2,
      ),
      'utf-8',
    )
  } catch (err) {
    console.warn('[electron] 写入 window-state.json 失败:', err)
  }
}

/**
 * 把保存的 bounds 应用到新窗口。
 * 如果保存的位置落在当前屏幕可视区域外（用户换了显示器），
 * 只恢复 width/height，让系统决定居中位置。
 */
export function applyBounds(win: BrowserWindow): void {
  const saved = loadBounds()
  if (!saved) return

  const display = screen.getDisplayMatching(saved)
  const workArea = display.workArea

  const fitsScreen =
    saved.x >= workArea.x &&
    saved.y >= workArea.y &&
    saved.x + saved.width <= workArea.x + workArea.width &&
    saved.y + saved.height <= workArea.y + workArea.height

  if (fitsScreen) {
    win.setBounds(saved)
  } else {
    // 位置超出了当前屏幕，只恢复尺寸
    win.setSize(saved.width, saved.height)
  }

  if (saved.maximized) {
    win.maximize()
  }
}

/** 监听窗口 resize/close 自动保存 bounds */
export function bindAutoSave(win: BrowserWindow): void {
  let resizeTimer: ReturnType<typeof setTimeout> | null = null

  win.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => saveBounds(win), 300)
  })

  win.on('move', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => saveBounds(win), 300)
  })

  win.on('close', () => saveBounds(win))
}
