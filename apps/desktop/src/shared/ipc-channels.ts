/**
 * Electron 主进程 ↔ preload 共享的 IPC 频道名常量
 * 主进程注册 handlers、preload 调用 invoke 时都引用这里，
 * 避免字符串散落、拼写错误、命名空间冲突。
 */

// ── 桌面原生能力（方案 A Phase 1-3 预留） ──────────────────
export const DESKTOP = {
  CHOOSE_DIRECTORY: 'desktop:chooseDirectory',
  SAVE_FILE: 'desktop:saveFile',
  OPEN_EXTERNAL: 'desktop:openExternal',
  GET_APP_INFO: 'desktop:getAppInfo',
} as const

// ── 服务进程控制（Phase 2+ 预留） ────────────────────────────
export const SERVER = {
  SET_API_KEY: 'server:setApiKey',
  GET_STATUS: 'server:getStatus',
} as const

export type IpcChannel = (typeof DESKTOP)[keyof typeof DESKTOP] | (typeof SERVER)[keyof typeof SERVER]
