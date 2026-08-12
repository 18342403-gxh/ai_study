/**
 * 知识点 6.6：引用来源卡片
 *
 * 学习要点：
 * - Citation 数据展示
 * - 引用编号标记
 * - 相关度分数可视化
 */

import type { Citation } from './types'

interface CitationCardProps {
  citation: Citation
}

const CitationCard: React.FC<CitationCardProps> = ({ citation }) => {
  return (
    <div className="glass-card rounded-lg p-3">
      {/* 顶部：编号 + 来源 + 分数 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-indigo-500/30 text-indigo-300 text-xs flex items-center justify-center">
            {citation.chunkIndex}
          </span>
          <span className="text-xs text-slate-400">{citation.source}</span>
        </div>
        <span className="text-xs text-slate-500">
          相关度 {Math.round(citation.score * 100)}%
        </span>
      </div>

      {/* 原文内容（截取前 200 字） */}
      <p className="text-xs text-slate-300 leading-relaxed line-clamp-4">
        {citation.content}
      </p>
    </div>
  )
}

export default CitationCard
