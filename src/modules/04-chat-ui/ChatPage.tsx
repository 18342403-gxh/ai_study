/**
 * 知识点 4.9：聊天主页面
 *
 * 学习要点：
 * - 全屏对话布局（顶部标题栏 + 消息区 + 底部输入栏）
 * - 集成 zustand store 管理会话状态
 * - 流式输出集成（通过 useChatStream hook）
 * - 会话切换和新建
 *
 * 面试相关：
 * - 移动端全屏聊天布局的 CSS 方案
 * - 如何拆分复杂页面逻辑为自定义 Hook
 */

import { useState, useCallback, useEffect } from 'react'
import { LeftOutline, AddOutline, DeleteOutline } from 'antd-mobile-icons'
import { useNavigate } from 'react-router-dom'

import { useChatStore } from './useChatStore'
import { useChatStream } from './useChatStream'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import SessionList from './SessionList'

const ChatPage: React.FC = () => {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [isSessionListVisible, setIsSessionListVisible] = useState(false)

  const {
    sessions,
    currentSessionId,
    getCurrentSession,
    createSession,
    switchSession,
    deleteSession,
    clearCurrentMessages,
  } = useChatStore()

  const currentSession = getCurrentSession()
  const messages = currentSession?.messages ?? []

  // 流式请求逻辑封装到独立 Hook
  const { isStreaming, handleSend: sendMessage, handleStop } = useChatStream(messages)

  // 如果没有会话，自动创建一个
  useEffect(() => {
    if (sessions.length === 0) {
      createSession()
    } else if (!currentSessionId) {
      switchSession(sessions[0].id)
    }
  }, [sessions, currentSessionId, createSession, switchSession])

  // 发送消息：取输入内容发送并清空输入框
  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed) return
    setInput('')
    sendMessage(trimmed)
  }, [input, sendMessage])

  const handleNewSession = useCallback(() => {
    createSession()
    setIsSessionListVisible(false)
  }, [createSession])

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
            onClick={clearCurrentMessages}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400"
          >
            <DeleteOutline />
          </button>
        </div>
      </header>

      {/* 会话列表（点击标题展开） */}
      {isSessionListVisible && (
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSwitch={(id) => {
            switchSession(id)
            setIsSessionListVisible(false)
          }}
          onDelete={deleteSession}
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
