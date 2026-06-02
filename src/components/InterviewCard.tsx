import { useState } from 'react'

interface InterviewCardProps {
  question: string
  difficulty: 'junior' | 'mid' | 'senior'
  category: 'principle' | 'coding' | 'design'
  answerPoints: string[]
}

const difficultyMap: Record<InterviewCardProps['difficulty'], { label: string; className: string }> = {
  junior: { label: '初级', className: 'bg-green-100 text-green-700' },
  mid: { label: '中级', className: 'bg-orange-100 text-orange-700' },
  senior: { label: '高级', className: 'bg-red-100 text-red-700' },
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
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
      {/* 难度 + 分类标签 */}
      <div className="flex items-center gap-2">
        <span className={`text-xs px-2 py-0.5 rounded ${diff.className}`}>
          🎯 {diff.label}
        </span>
        <span className="text-xs text-gray-500">|</span>
        <span className="text-xs text-gray-600">{categoryMap[category]}</span>
      </div>

      {/* 题目 */}
      <p className="text-sm font-medium text-gray-900 mt-2">Q: {question}</p>

      {/* 答案区域 */}
      {expanded && (
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-1">答案要点：</p>
          <ul className="space-y-1">
            {answerPoints.map((point, idx) => (
              <li key={idx} className="text-sm text-gray-700">• {point}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 切换按钮 */}
      <div className="flex justify-center mt-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-sm text-blue-500"
        >
          {expanded ? '收起答案 ▲' : '查看答案 ▼'}
        </button>
      </div>
    </div>
  )
}

export default InterviewCard
