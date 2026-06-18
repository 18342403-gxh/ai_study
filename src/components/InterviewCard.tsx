import { useState } from 'react'
import { StarOutline } from 'antd-mobile-icons'

interface InterviewCardProps {
  question: string
  difficulty: 'junior' | 'mid' | 'senior'
  category: 'principle' | 'coding' | 'design'
  answerPoints: string[]
}

const difficultyMap: Record<InterviewCardProps['difficulty'], { label: string; className: string }> = {
  junior: { label: '初级', className: 'bg-emerald-500/20 text-emerald-400' },
  mid: { label: '中级', className: 'bg-amber-500/20 text-amber-400' },
  senior: { label: '高级', className: 'bg-rose-500/20 text-rose-400' },
}

const categoryMap: Record<InterviewCardProps['category'], string> = {
  principle: '原理理解',
  coding: '代码实现',
  design: '场景设计',
}

const InterviewCard: React.FC<InterviewCardProps> = ({ question, difficulty, category, answerPoints }) => {
  const [expanded, setExpanded] = useState(false)

  const diff = difficultyMap[difficulty]

  return (
    <div className="glass-card rounded-xl p-4">
      {/* 难度 + 分类标签 */}
      <div className="flex items-center gap-2">
        <span className={`text-xs px-2 py-0.5 rounded inline-flex items-center gap-1 ${diff.className}`}>
          <StarOutline fontSize={10} /> {diff.label}
        </span>
        <span className="text-xs text-slate-500">|</span>
        <span className="text-xs text-slate-400">{categoryMap[category]}</span>
      </div>

      {/* 题目 */}
      <p className="text-sm font-medium text-slate-200 mt-2">Q: {question}</p>

      {/* 答案区域 */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 mb-2">答案要点：</p>
          <ul className="space-y-1.5">
            {answerPoints.map((point, idx) => (
              <li key={idx} className="text-sm text-slate-300 flex items-start gap-2">
                <span className="text-indigo-400 shrink-0 mt-1 text-xs">▸</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 切换按钮 */}
      <div className="flex justify-center mt-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xs text-indigo-400"
        >
          {expanded ? '收起答案 ▲' : '查看答案 ▼'}
        </button>
      </div>
    </div>
  )
}

export default InterviewCard
