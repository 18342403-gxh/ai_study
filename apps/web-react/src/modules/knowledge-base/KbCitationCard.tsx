/**
 * 知识库引用来源卡片 — Dify 风格
 */

import type { KbCitation } from './types'

interface KbCitationCardProps {
  citation: KbCitation
}

const KbCitationCard: React.FC<KbCitationCardProps> = ({ citation }) => {
  return (
    <div className="glass-card rounded-xl px-3 py-2.5 border-l-2 border-indigo-500/50">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-indigo-500/30 text-indigo-300 text-[10px] font-bold flex items-center justify-center">
            {citation.index}
          </span>
          <span className="text-xs text-slate-300 font-medium truncate max-w-[120px]">
            {citation.source}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-12 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500"
              style={{ width: `${citation.score * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 w-7 text-right">
            {Math.round(citation.score * 100)}%
          </span>
        </div>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
        {citation.content}
      </p>
    </div>
  )
}

export default KbCitationCard
