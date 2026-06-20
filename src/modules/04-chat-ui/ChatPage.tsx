/**
 * 知识点 4.9：聊天主页面
 *
 * 学习要点：
 * - 全屏对话布局（顶部标题栏 + 消息区 + 底部输入栏）
 * - 集成 Redux Toolkit 管理会话状态
 * - 流式输出集成（通过 useChatStream hook）
 * - 会话切换和新建
 *
 * 面试相关：
 * - 移动端全屏聊天布局的 CSS 方案
 * - Redux useSelector 的性能：如何避免不必要重渲染
 */

import { useState, useCallback, useEffect } from 'react'
import { LeftOutline, AddOutline, DeleteOutline } from 'antd-mobile-icons'
import { useNavigate } from 'react-router-dom'

import { useAppDispatch, useAppSelector } from '../../store'
import type { RootState } from '../../store'
import {
  createSession,
  switchSession,
  deleteSession,
  clearCurrentMessages,
} from '../../store/chatSlice'
import { useChatStream } from './useChatStream'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import SessionList from './SessionList'

const ChatPage: React.FC = () => {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const [input, setInput] = useState('')
  const [isSessionListVisible, setIsSessionListVisible] = useState(false)

  // 📝 面试考点：useSelector 精确选取需要的 state，避免整个 store 变化都触发重渲染
  const sessions = useAppSelector((state: RootState) => state.chat.sessions)
  const currentSessionId = useAppSelector((state: RootState) => state.chat.currentSessionId)
  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const messages = currentSession?.messages ?? []

  // 流式请求逻辑封装到独立 Hook
  const { isStreaming, handleSend: sendMessage, handleStop } = useChatStream(messages)

  // 如果没有会话，自动创建一个
  useEffect(() => {
    if (sessions.length === 0) {
      dispatch(createSession())
    } else if (!currentSessionId) {
      dispatch(switchSession(sessions[0].id))
    }
  }, [sessions, currentSessionId, dispatch])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed) return
    setInput('')
    sendMessage(trimmed)
  }, [input, sendMessage])

  const handleNewSession = useCallback(() => {
    dispatch(createSession())
    setIsSessionListVisible(false)
  }, [dispatch])

  return (
    <div className="h-screen flex flex-col tech-gradient-bg">
      {/* 顶部栏 */}
      <header className="h-11 flex items-center justify-between px-4 glass-nav shrink-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2 text-slate-400"
        >
          <LeftOutline />
        </button>
        <button
          type="button"
          onClick={() => setIsSessionListVisible(!isSessionListVisible)}
          className="text-sm text-slate-200 truncate max-w-[200px]"
        >
          {currentSession?.title || '新对话'}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleNewSession}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400"
          >
            <AddOutline />
          </button>
          <button
            type="button"
            onClick={() => dispatch(clearCurrentMessages())}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400"
          >
            <DeleteOutline />
          </button>
        </div>
      </header>

      {/* 会话列表 */}
      {isSessionListVisible && (
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSwitch={(id) => {
            dispatch(switchSession(id))
            setIsSessionListVisible(false)
          }}
          onDelete={(id) => dispatch(deleteSession(id))}
        />
      )}

      {/* 消息列表 */}
      <MessageList messages={messages} isStreaming={isStreaming} />

      {/* 底部输入栏 */}
      <ChatInput
        value={input}
        isDisabled={isStreaming}
        onChange={setInput}
        onSend={isStreaming ? handleStop : handleSend}
      />
    </div>
  )
}

export default ChatPage
