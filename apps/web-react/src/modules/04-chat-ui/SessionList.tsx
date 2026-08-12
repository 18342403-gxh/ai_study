/**
 * 会话列表下拉面板
 * 展示所有聊天会话，支持切换和删除
 */

import { DeleteOutline } from 'antd-mobile-icons'

import type { ChatSession } from '../../store/chatSlice'

interface SessionListProps {
  sessions: ChatSession[]
  currentSessionId: string | null
  onSwitch: (sessionId: string) => void
  onDelete: (sessionId: string) => void
}

const SessionList: React.FC<SessionListProps> = ({
  sessions,
  currentSessionId,
  onSwitch,
  onDelete,
}) => {
  return (
    <div className="absolute top-11 left-0 right-0 z-40 glass-nav border-b border-slate-700/50 max-h-[300px] overflow-y-auto">
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          onClick={() => onSwitch(session.id)}
          className={`w-full px-4 py-3 text-left text-sm flex items-center justify-between ${
            session.id === currentSessionId ? 'text-indigo-400' : 'text-slate-300'
          }`}
        >
          <span className="truncate">{session.title}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(session.id)
            }}
            className="text-slate-500 min-w-[32px] min-h-[32px] flex items-center justify-center"
          >
            <DeleteOutline fontSize={14} />
          </button>
        </button>
      ))}
    </div>
  )
}

export default SessionList
