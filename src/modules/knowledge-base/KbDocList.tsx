/**
 * 知识库文档列表组件
 */

import { DeleteOutline, CheckCircleFill, ClockCircleFill, CloseCircleFill } from 'antd-mobile-icons'

import type { KbDocument } from './types'

interface KbDocListProps {
  documents: KbDocument[]
  onDelete: (docId: string) => void
}

/** 文件大小格式化 */
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_MAP = {
  processing: { icon: <ClockCircleFill />, label: '处理中', color: 'text-amber-400' },
  ready: { icon: <CheckCircleFill />, label: '就绪', color: 'text-emerald-400' },
  failed: { icon: <CloseCircleFill />, label: '失败', color: 'text-rose-400' },
}

const KbDocList: React.FC<KbDocListProps> = ({ documents, onDelete }) => {
  if (documents.length === 0) {
    return <p className="text-xs text-slate-500 text-center py-4">暂无文档</p>
  }

  return (
    <div className="space-y-2">
      {documents.map((doc) => {
        const statusInfo = STATUS_MAP[doc.status]
        return (
          <div key={doc.id} className="glass-card rounded-lg p-3 flex items-center gap-3">
            <span className={`shrink-0 ${statusInfo.color}`}>{statusInfo.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-200 truncate">{doc.name}</div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                <span>{formatSize(doc.size)}</span>
                {doc.chunk_count > 0 && <span>· {doc.chunk_count} 块</span>}
                <span className={statusInfo.color}>{statusInfo.label}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDelete(doc.id)}
              className="min-w-[32px] min-h-[32px] flex items-center justify-center text-slate-500"
            >
              <DeleteOutline fontSize={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default KbDocList
