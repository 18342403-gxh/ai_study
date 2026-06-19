/**
 * 知识点 4.2/4.7：消息列表组件（自动滚动 + 滚动锁定）
 *
 * 学习要点：
 * - IntersectionObserver 检测底部元素可见性
 * - 新消息到达时自动滚动到底部
 * - 用户上翻时暂停自动滚动（"滚动锁定"）
 * - useRef 存储 DOM 引用和非渲染状态
 *
 * 面试相关：
 * - IntersectionObserver 的工作原理和配置参数
 * - 自动滚动 + 用户上翻暂停的实现思路
 * - 为什么用 ref 而不是 state 存储 isAtBottom
 */

import { useRef, useEffect, useCallback } from 'react'

import MessageBubble from './MessageBubble'
import type { ChatMessage } from '../../store/chatSlice'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming?: boolean  // 是否正在流式生成（用于触发滚动）
}

const MessageList: React.FC<MessageListProps> = ({ messages, isStreaming }) => {
  // 消息容器 DOM 引用，作为 IntersectionObserver 的 root
  const containerRef = useRef<HTMLDivElement>(null)
  // 底部哨兵元素引用，Observer 观察它来判断用户是否在底部
  const bottomRef = useRef<HTMLDivElement>(null)
  /**
   * 📝 面试考点：用 ref 而非 state 存储"是否在底部"
   * 原因：这个值变化非常频繁（每次滚动都会触发），如果用 state 会导致大量无意义重渲染
   * ref 变化不触发渲染，仅在需要读取时通过 .current 获取最新值
   */
  const isAtBottomRef = useRef(true)

  /**
   * 📝 面试考点：IntersectionObserver API
   * - 异步观察目标元素与祖先容器的交叉状态
   * - 比 scroll 事件监听更高效（浏览器内部优化，不阻塞主线程）
   * - threshold: 0.1 表示目标有 10% 可见时就触发回调
   * - root: 指定滚动容器（默认是 viewport）
   */
  useEffect(() => {
    const bottomEl = bottomRef.current
    if (!bottomEl) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        // entry.isIntersecting 为 true = 底部哨兵可见 = 用户在底部
        isAtBottomRef.current = entry.isIntersecting
      },
      { root: containerRef.current, threshold: 0.1 }
    )

    observer.observe(bottomEl)
    // 📝 面试考点：cleanup 函数中 disconnect 防止内存泄漏
    return () => observer.disconnect()
  }, [])

  /**
   * 滚动到底部
   * 📝 面试考点：仅当用户处于底部时才自动滚动
   * 如果用户手动上翻查看历史消息，不应该把他拉回底部
   */
  const scrollToBottom = useCallback(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  // 当消息数量变化或流式状态变化时，尝试滚动到底部
  useEffect(() => {
    scrollToBottom()
  }, [messages.length, isStreaming, scrollToBottom])

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-slate-500">发送消息开始对话</p>
        </div>
      ) : (
        messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))
      )}
      {/* 底部哨兵元素：IntersectionObserver 观察它来判断滚动位置 */}
      <div ref={bottomRef} className="h-1" />
    </div>
  )
}

export default MessageList
