/**
 * 知识点 6.3/6.4：文档列表管理 + 处理状态展示
 *
 * 学习要点：
 * - 文档状态枚举展示（uploading/parsing/ready/failed）
 * - 列表 CRUD 操作
 * - 状态指示器 UI
 */

import { DeleteOutline, CheckCircleFill } from 'antd-mobile-icons'

import type { RagDocument } from './types'

interface DocumentListProps {
  documents: RagDocument[]
  onDelete: (docId: string) => void
}

/** 状态标签配置 */
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  uploading: { label: '上传中', className: 'bg-blue-500/20 text-blue-400' },
  parsing: { label: '解析中', className: 'bg-amber-500/20 text-amber-400' },
  ready: { label: '就绪', className: 'bg-emerald-500/20 text-emerald-400' },
  failed: { label: '失败', className: 'bg-rose-500/20 text-rose-400' },
}

const DocumentList: React.FC<DocumentListProps> = ({ documents, onDelete }) => {
  if (documents.length === 0) {
    return (
      <p className="text-xs text-slate-500 text-center py-4">暂无文档，请上传文件</p>
    )
  }

  return (
    <div className="space-y-2">
      {documents.map((doc) => {
        const statusInfo = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.failed
        return (
          <div key={doc.id} className="glass-card rounded-lg p-3 flex items-center gap-3">
            {/* 状态图标 */}
            <CheckCircleFill className={`shrink-0 ${
              doc.status === 'ready' ? 'text-emerald-400' : 'text-slate-500'
            }`} />

            {/* 文档信息 */}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-200 truncate">{doc.name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs px-1.5 py-0.5 rounded ${statusInfo.className}`}>
                  {statusInfo.label}
                </span>
                <span className="text-xs text-slate-500">
                  {doc.chunks.length} 个分块
                </span>
              </div>
            </div>

            {/* 删除按钮 */}
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

export default DocumentList
