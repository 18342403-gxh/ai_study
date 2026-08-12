/**
 * 知识点 5.2/5.8：工具执行器
 *
 * 学习要点：
 * - 函数映射表（name → function），根据名称分发执行
 * - JSON.parse 解析 AI 返回的参数字符串
 * - try-catch 包裹执行，失败时返回错误信息给 AI
 *
 * 面试相关：
 * - 策略模式在工具执行中的应用
 * - 工具执行失败如何优雅降级
 */

import { getWeather } from './weather'

// 📝 面试考点：函数映射表 — 策略模式，根据名称查找并执行对应函数
const toolFunctions: Record<string, (params: Record<string, string>) => string> = {
  get_weather: (params) => getWeather(params as { city: string }),

  // 计算器工具：使用 Function 构造器执行数学表达式
  calculate: (params) => {
    const { expression } = params
    try {
      // 📝 面试考点：安全考虑 — 生产环境应使用 math.js 等库而非 eval
      // 这里用正则限制只允许数字和基本运算符
      const isSafeExpression = /^[\d+\-*/().%\s]+$/.test(expression)
      if (!isSafeExpression) {
        return JSON.stringify({ error: '不支持的表达式' })
      }
      const result = new Function(`return (${expression})`)()
      return JSON.stringify({ expression, result: Number(result) })
    } catch {
      return JSON.stringify({ error: `计算失败: ${expression}` })
    }
  },

  // 获取当前时间
  get_current_time: () => {
    const now = new Date()
    return JSON.stringify({
      date: now.toLocaleDateString('zh-CN'),
      time: now.toLocaleTimeString('zh-CN'),
      timestamp: now.getTime(),
    })
  },
}

/**
 * 工具调用信息（从 AI 响应中提取）
 */
export interface ToolCall {
  id: string
  function: {
    name: string
    arguments: string  // JSON 字符串
  }
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  toolCallId: string
  name: string
  result: string
  isError: boolean
}

/**
 * 执行单个工具调用
 * 📝 面试考点：错误不会抛出，而是作为结果返回给 AI，让 AI 决定如何处理
 */
export const executeTool = (toolCall: ToolCall): ToolResult => {
  const { id, function: fn } = toolCall
  const executor = toolFunctions[fn.name]

  // 工具不存在
  if (!executor) {
    return {
      toolCallId: id,
      name: fn.name,
      result: JSON.stringify({ error: `未知工具: ${fn.name}` }),
      isError: true,
    }
  }

  try {
    // 📝 面试考点：AI 返回的 arguments 是 JSON 字符串，需要 parse
    const params = JSON.parse(fn.arguments || '{}')
    const result = executor(params)
    return { toolCallId: id, name: fn.name, result, isError: false }
  } catch (err) {
    // 执行失败，把错误信息返回给 AI
    const errorMsg = err instanceof Error ? err.message : '工具执行失败'
    return {
      toolCallId: id,
      name: fn.name,
      result: JSON.stringify({ error: errorMsg }),
      isError: true,
    }
  }
}

/**
 * 批量执行工具调用（AI 可能一次返回多个 tool_calls）
 */
export const executeTools = (toolCalls: ToolCall[]): ToolResult[] => {
  return toolCalls.map(executeTool)
}
