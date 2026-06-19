/**
 * 知识点 4.3：消息气泡组件
 *
 * 学习要点：
 * - 用户/AI 消息不同对齐和配色
 * - 气泡最大宽度控制（max-w-[80%]）
 * - AI 消息使用 Markdown 渲染
 *
 * 面试相关：
 * - CSS 实现气泡左右对齐的几种方案
 */

import MarkdownRenderer from './MarkdownRenderer'
import type { ChatMessage } from '../../store/chatSlice'

interface MessageBubbleProps {
  message: ChatMessage
}

// 📝 面试考点：根据 role 决定气泡对齐方向和颜色
const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] px-3 py-2.5 rounded-2xl text-sm ${
          isUser
            ? 'bg-indigo-500/80 text-white rounded-br-md'
            : 'glass-card text-slate-200 rounded-bl-md'
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>
    </div>
  )
}

export default MessageBubble
