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
 *   - 所有桌面能力都通过 ipcRenderer.invoke() 发消息给主进程
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
      getServerStatus: () => Promise<{ serverUrl: string; generatorUrl: string }>
    }
  }
}

contextBridge.exposeInMainWorld('desktop', {
  chooseDirectory: () =>
    ipcRenderer.invoke(DESKTOP.CHOOSE_DIRECTORY),

  saveFile: (filename: string, content: string) =>
    ipcRenderer.invoke(DESKTOP.SAVE_FILE, filename, content),

  openExternal: (url: string) =>
    ipcRenderer.invoke(DESKTOP.OPEN_EXTERNAL, url),

  getAppInfo: () =>
    ipcRenderer.invoke(DESKTOP.GET_APP_INFO),

  setApiKey: (key: string) =>
    ipcRenderer.invoke(SERVER.SET_API_KEY, key),

  getServerStatus: () =>
    ipcRenderer.invoke(SERVER.GET_STATUS),
})
