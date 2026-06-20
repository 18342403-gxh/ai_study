/**
 * Redux Store 配置
 *
 * 企业级实践：
 * - configureStore 自动集成 Redux DevTools 和中间件
 * - 按业务域拆分 slice，通过 reducer 合并
 * - 导出 RootState 和 AppDispatch 类型供全局使用
 * - subscribe 实现 localStorage 持久化
 */

import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import type { TypedUseSelectorHook } from 'react-redux'

import chatReducer from './chatSlice'

export const store = configureStore({
  reducer: {
    chat: chatReducer,
  },
})

// 导出类型
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

// 📝 面试考点：类型化 hooks 避免每次使用时手动指定泛型
export const useAppDispatch: () => AppDispatch = useDispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector

// 注册持久化：state 变化时自动写入 localStorage
const STORAGE_KEY = 'chat-sessions-storage'
store.subscribe(() => {
  const chatState = store.getState().chat
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chatState))
  } catch {
    // localStorage 写入失败静默处理
  }
})
