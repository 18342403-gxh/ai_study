/**
 * Electron Preload 脚本
 *
 * 唯一职责：通过 contextBridge 向渲染进程暴露安全的桌面能力。
 * 渲染进程（generator 前端）只能访问 window.desktop.xxx，
 * 永远不能 import 'electron' 或 require('electron')。
 *
 * 安全约束：
 *   - contextIsolation: true → preload 和 renderer 有独立 JS 上下文
 *   - nodeIntegration: false → renderer 没有 Node API
 *   - 所有桌面能力都通过 ipcRenderer.invoke() / ipcRenderer.on() 发消息给主进程
 */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP, SERVER } from '../shared/ipc-channels.js'

// 暴露到 window.desktop 的类型声明（给渲染进程 TS 用）
declare global {
  interface Window {
    desktop: {
      /** 让用户选择本地目录（对话框） */
      chooseDirectory: () => Promise<string | null>
      /** 保存文件到本地（对话框 + 写入） */
      saveFile: (filename: string, content: string) => Promise<string | false>
      /** 用系统默认浏览器打开外部链接 */
      openExternal: (url: string) => Promise<boolean>
      /** 获取桌面应用信息（版本/平台/数据目录） */
      getAppInfo: () => Promise<{
        name: string
        version: string
        platform: NodeJS.Platform
        arch: NodeJS.Architecture
        userDataPath: string
      }>
      /** 设置 API Key（写入桌面端存储） */
      setApiKey: (key: string) => Promise<{ ok: boolean; note?: string }>
      /** 查询 server 子进程状态 */
      getServerStatus: () => Promise<{
        serverUrl: string
        generatorUrl: string
        serverRunning: boolean
        generatorRunning: boolean
      }>
      /** 发送系统桌面通知 */
      showNotification: (options: {
        title: string
        body?: string
        silent?: boolean
      }) => Promise<boolean>
      /** 监听窗口内文件拖拽事件（主进程拦截后转发） */
      onFileDropped: (listener: (filePaths: string[]) => void) => () => void
      /** 监听主进程推送的事件（如托盘操作） */
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void
    }
  }
}

contextBridge.exposeInMainWorld('desktop', {
  chooseDirectory: () => ipcRenderer.invoke(DESKTOP.CHOOSE_DIRECTORY),

  saveFile: (filename: string, content: string) =>
    ipcRenderer.invoke(DESKTOP.SAVE_FILE, filename, content),

  openExternal: (url: string) => ipcRenderer.invoke(DESKTOP.OPEN_EXTERNAL, url),

  getAppInfo: () => ipcRenderer.invoke(DESKTOP.GET_APP_INFO),

  setApiKey: (key: string) => ipcRenderer.invoke(SERVER.SET_API_KEY, key),

  getServerStatus: () => ipcRenderer.invoke(SERVER.GET_STATUS),

  showNotification: (options: { title: string; body?: string; silent?: boolean }) =>
    ipcRenderer.invoke(DESKTOP.SHOW_NOTIFICATION, options),

  /**
   * 注册文件拖拽监听。返回注销函数（unsubscribe）。
   * 主进程拦截渲染进程里的文件拖拽后，通过 ipcRenderer.send 转发。
   */
  onFileDropped: (listener: (filePaths: string[]) => void) => {
    const handler = (_evt: unknown, paths: string[]) => listener(paths)
    ipcRenderer.on(DESKTOP.FILE_DROPPED, handler)
    return () => ipcRenderer.removeListener(DESKTOP.FILE_DROPPED, handler)
  },

  /** 通用事件订阅（供渲染进程监听主进程推送的任意事件） */
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const handler = (_evt: unknown, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
})

// ── 文件拖拽拦截（preload 层面）─────────────────────
// 拦截 DOM 级 dragover/drop，阻止浏览器默认行为（会触发 file:// 导航），
// 提取真实文件路径（Electron preload 里 File.path 可用），
// 通过 IPC send 到主进程，由主进程再转发回渲染进程。
//
// 为什么要在 preload 做：
//   - renderer 里 contextIsolation + nodeIntegration=false → File.path 不可用
//   - preload 共享 DOM 但有 Node/Electron API → File.path 可用
//   - 阻止默认行为最彻底（不依赖页面里有没有监听 dragover）
{
  // preload 里的 globalThis 有完整的 DOM + Node API
  const w: Window = globalThis as unknown as Window

  w.addEventListener('dragover', (e: Event) => {
    e.preventDefault()
  })

  w.addEventListener('drop', (e: Event) => {
    e.preventDefault()
    const ce = e as DragEvent
    const files: string[] = []
    const dataTransfer = ce.dataTransfer
    if (dataTransfer?.files) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const file = dataTransfer.files[i] as File & { path?: string }
        // Electron preload 特有：File 对象有 .path 属性（绝对路径）
        if (file.path) {
          files.push(file.path)
        }
      }
    }
    if (files.length > 0) {
      ipcRenderer.send(DESKTOP.FILE_DROPPED, files)
    }
  })
}
