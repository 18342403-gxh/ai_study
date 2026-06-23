/**
 * 知识点 7.4：执行时间线组件
 *
 * 学习要点：
 * - 垂直时间线布局（CSS border-left + 圆点节点）
 * - 步骤节点状态样式（thinking/tool_call/tool_result/final_answer）
 * - 实时追加新步骤
 */

import { SmileOutline, SetOutline, CheckCircleFill, CloseCircleFill } from 'antd-mobile-icons'

import type { AgentStep } from './types'

interface AgentTimelineProps {
  steps: AgentStep[]
}

/** 根据步骤类型返回对应的图标和颜色 */
const getStepStyle = (step: AgentStep) => {
  switch (step.type) {
    case 'thinking':
      return { icon: <SmileOutline />, color: 'text-indigo-400', bg: 'bg-indigo-500/20', label: '思考' }
    case 'tool_call':
      return { icon: <SetOutline />, color: 'text-cyan-400', bg: 'bg-cyan-500/20', label: '调用工具' }
    case 'tool_result':
      return {
        icon: step.isError ? <CloseCircleFill /> : <CheckCircleFill />,
        color: step.isError ? 'text-rose-400' : 'text-emerald-400',
        bg: step.isError ? 'bg-rose-500/20' : 'bg-emerald-500/20',
        label: step.isError ? '执行失败' : '执行结果',
      }
    case 'final_answer':
      return { icon: <CheckCircleFill />, color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: '最终回答' }
    default:
      return { icon: null, color: 'text-slate-400', bg: 'bg-slate-700', label: '' }
  }
}

const AgentTimeline: React.FC<AgentTimelineProps> = ({ steps }) => {
  if (steps.length === 0) return null

  return (
    <div className="relative pl-6">
      {/* 垂直连接线 */}
      <div className="absolute left-[11px] top-3 bottom-3 w-px bg-slate-700" />

      {/* 步骤节点 */}
      <div className="space-y-3">
        {steps.map((step) => {
          const style = getStepStyle(step)
          return (
            <div key={step.id} className="relative">
              {/* 节点圆点 */}
              <div className={`absolute -left-6 top-1 w-[22px] h-[22px] rounded-full ${style.bg} ${style.color} flex items-center justify-center text-xs`}>
                {style.icon}
              </div>

              {/* 内容卡片 */}
              <div className="glass-card rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium ${style.color}`}>{style.label}</span>
                  {step.toolName && (
                    <span className="text-xs text-slate-500">{step.toolName}</span>
                  )}
                </div>
                <div className="text-sm text-slate-300 whitespace-pre-wrap break-words">
                  {step.content}
                </div>
                {step.toolArgs && (
                  <div className="mt-1 text-xs text-slate-500 font-mono truncate">
                    参数：{step.toolArgs}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AgentTimeline
