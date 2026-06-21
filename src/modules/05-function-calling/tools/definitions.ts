/**
 * 知识点 5.1：工具 Schema 定义
 *
 * 学习要点：
 * - 按 OpenAI 规范定义工具的 JSON Schema
 * - name: 工具唯一标识，AI 通过它识别调用哪个工具
 * - description: 告诉 AI 什么场景下该使用这个工具（非常关键）
 * - parameters: JSON Schema 定义参数类型和约束
 *
 * 面试相关：
 * - description 为什么是 Function Calling 中最关键的字段
 * - JSON Schema 的类型系统
 */

/**
 * 📝 面试考点：工具定义的 TypeScript 接口
 * 这个结构会作为 API 请求的 tools 参数发送
 */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, {
        type: string
        description: string
        enum?: string[]
      }>
      required: string[]
    }
  }
}

/**
 * 📝 面试考点：description 是 AI 判断"要不要调用这个工具"的唯一依据
 * 写得越清晰，AI 的调用准确率越高
 */
export const toolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '获取指定城市的当前天气信息，包括温度、天气状况和湿度',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称，如"北京"、"上海"、"深圳"',
          },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: '执行数学计算，支持加减乘除和常见数学运算',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，如"2+3*4"、"sqrt(16)"、"100/3"',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取当前日期和时间',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
]
