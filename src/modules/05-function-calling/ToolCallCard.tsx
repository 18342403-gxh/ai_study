/**
 * 知识点 5.5/5.6：工具调用状态展示 + 多工具结果可视化
 *
 * 学习要点：
 * - 根据工具名称条件渲染不同的结果卡片
 * - 工具调用中的 loading 状态展示
 * - JSON 结果格式化展示
 */

import { SetOutline, CheckCircleFill, CloseCircleFill } from 'antd-mobile-icons'

import type { ToolStep } from './useToolChat'

interface ToolCallCardProps {
  step: ToolStep
}

/** 工具名称的中文映射 */
const TOOL_NAME_MAP: Record<string, string> = {
  get_weather: '天气查询',
  calculate: '数学计算',
  get_current_time: '获取时间',
}

/** 尝试解析 JSON 并格式化展示 */
const formatResult = (jsonStr: string): string => {
  try {
    const obj = JSON.parse(jsonStr)
    if (obj.error) return `错误：${obj.error}`
    // 天气结果
    if (obj.temperature !== undefined) {
      return `${obj.city} | ${obj.condition} | ${obj.temperature}°C | 湿度 ${obj.humidity}%`
    }
    // 计算结果
    if (obj.result !== undefined) {
      return `${obj.expression} = ${obj.result}`
    }
    // 时间结果
    if (obj.date) {
      return `${obj.date} ${obj.time}`
    }
    return JSON.stringify(obj, null, 2)
  } catch {
    return jsonStr
  }
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({ step }) => {
  const toolLabel = step.toolName ? (TOOL_NAME_MAP[step.toolName] || step.toolName) : ''

  // 工具调用步骤
  if (step.type === 'tool_call') {
    return (
      <div className="glass-card rounded-lg p-3 flex items-start gap-2">
        <SetOutline className="text-indigo-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-xs text-slate-400">调用工具：{toolLabel}</div>
          {step.toolArgs && (
            <div className="text-xs text-slate-500 mt-1 font-mono truncate">
              参数：{step.toolArgs}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 工具结果步骤
  if (step.type === 'tool_result') {
    const isError = step.isError
    return (
      <div className={`glass-card rounded-lg p-3 flex items-start gap-2 ${
        isError ? 'border-rose-500/30' : 'border-emerald-500/30'
      }`}>
        {isError
          ? <CloseCircleFill className="text-rose-400 mt-0.5 shrink-0" />
          : <CheckCircleFill className="text-emerald-400 mt-0.5 shrink-0" />
        }
        <div className="min-w-0">
          <div className="text-xs text-slate-400">{toolLabel} 结果：</div>
          <div className={`text-sm mt-1 ${isError ? 'text-rose-300' : 'text-slate-200'}`}>
            {step.toolResult ? formatResult(step.toolResult) : '无结果'}
          </div>
        </div>
      </div>
    )
  }

  // 最终回答
  if (step.type === 'final_answer') {
    return (
      <div className="glass-card rounded-lg p-3">
        <div className="text-sm text-slate-200 whitespace-pre-wrap">
          {step.content}
        </div>
      </div>
    )
  }

  return null
}

export default ToolCallCard
