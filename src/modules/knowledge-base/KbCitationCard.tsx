/**
 * 知识库引用来源卡片
 */

import type { KbCitation } from './types'

interface KbCitationCardProps {
  citation: KbCitation
}

const KbCitationCard: React.FC<KbCitationCardProps> = ({ citation }) => {
  return (
    <div className="glass-card rounded-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-indigo-500/30 text-indigo-300 text-xs flex items-center justify-center">
            {citation.index}
          </span>
          <span className="text-xs text-slate-400 truncate max-w-[150px]">{citation.source}</span>
        </div>
        <span className="text-xs text-slate-500">
          {Math.round(citation.score * 100)}%
        </span>
      </div>
      <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">
        {citation.content}
      </p>
    </div>
  )
}

export default KbCitationCard
