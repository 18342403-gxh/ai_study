/**
 * 知识库文档列表 — Dify 风格
 */

import { DeleteOutline, FileOutline } from 'antd-mobile-icons'

import type { KbDocument } from './types'

interface KbDocListProps {
  documents: KbDocument[]
  onDelete: (docId: string) => void
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatTime = (ts: number): string => {
  const date = new Date(ts)
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`
}

const STATUS_STYLES = {
  processing: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-400', label: '处理中' },
  ready: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: '就绪' },
  failed: { dot: 'bg-rose-400', text: 'text-rose-400', label: '失败' },
}

const KbDocList: React.FC<KbDocListProps> = ({ documents, onDelete }) => {
  if (documents.length === 0) {
    return (
      <div className="text-center py-8">
        <FileOutline className="text-2xl text-slate-600 mx-auto mb-2" />
        <p className="text-xs text-slate-500">暂无文档</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {documents.map((doc) => {
        const style = STATUS_STYLES[doc.status]
        return (
          <div key={doc.id} className="glass-card rounded-xl px-3 py-3 flex items-center gap-3 group">
            {/* 文件图标 */}
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
              <FileOutline className="text-indigo-400" />
            </div>

            {/* 文档信息 */}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-200 truncate font-medium">{doc.name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                  <span className={`text-xs ${style.text}`}>{style.label}</span>
                </div>
                <span className="text-xs text-slate-600">·</span>
                <span className="text-xs text-slate-500">{formatSize(doc.size)}</span>
                {doc.chunk_count > 0 && (
                  <>
                    <span className="text-xs text-slate-600">·</span>
                    <span className="text-xs text-slate-500">{doc.chunk_count} 块</span>
                  </>
                )}
                <span className="text-xs text-slate-600">·</span>
                <span className="text-xs text-slate-500">{formatTime(doc.created_at)}</span>
              </div>
            </div>

            {/* 删除按钮 */}
            <button
              type="button"
              onClick={() => onDelete(doc.id)}
              className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg hover:bg-rose-500/10 hover:text-rose-400"
            >
              <DeleteOutline fontSize={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default KbDocList
