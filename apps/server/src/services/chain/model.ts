/**
 * LangChain 模型初始化（m1 基础）
 * 统一管理 ChatModel 实例，避免重复创建
 */

/** 支持的模型类型 */
export type ModelProvider = 'zhipu' | 'openai' | 'mock'

/** 模型初始化配置 */
export interface ModelConfig {
  provider?: ModelProvider
  model?: string
  temperature?: number
  maxTokens?: number
}

function getEnv() {
  return {
    apiUrl: process.env.AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.AI_API_KEY || '',
    defaultModel: process.env.AI_MODEL || 'glm-4-flash',
  }
}

/**
 * 创建 LangChain ChatModel 实例
 * 由于 @langchain/community 未内置智谱集成，这里通过
 * 自定义 Runnable 封装原生 fetch，保持 LangChain 抽象一致性
 */
export const createChatModel = (config: ModelConfig = {}) => {
  const { apiUrl, apiKey, defaultModel } = getEnv()
  const provider = config.provider || 'zhipu'
  const modelName = config.model || defaultModel
  const temperature = config.temperature ?? 0.7

  /**
   * 自定义 Runnable：封装 HTTP 调用为 LangChain Runnable 接口
   * 实现 Runnable.invoke() 接口，保持与 LangChain 链式调用兼容
   */
  return {
    /** 模型调用（非流式） */
    async invoke(input: Array<{ role: string; content: string }> | string): Promise<string> {
      const messages = typeof input === 'string'
        ? [{ role: 'user', content: input }]
        : input

      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature,
          stream: false,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`AI 请求失败 (${response.status}): ${errText}`)
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>
      }
      return data.choices[0]?.message?.content || ''
    },

    /** 模型调用（流式） */
    async *stream(
      input: Array<{ role: string; content: string }> | string,
      options?: { signal?: AbortSignal }
    ): AsyncGenerator<string> {
      const messages = typeof input === 'string'
        ? [{ role: 'user', content: input }]
        : input

      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature,
          stream: true,
        }),
        signal: options?.signal,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`AI 请求失败 (${response.status}): ${errText}`)
      }

      // SSE 流式解析
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法获取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          if (trimmed === 'data: [DONE]') return

          try {
            const json = JSON.parse(trimmed.slice(6))
            const delta = json.choices?.[0]?.delta?.content || ''
            if (delta) {
              yield delta
            }
          } catch {
            // 忽略解析错误的行
          }
        }
      }
    },

    /** 绑定工具（为 m5 Function Calling 预留接口） */
    bindTools(_tools: Array<{ name: string; description: string; schema: unknown }>) {
      return this
    },
  }
}

/** 类型导出：LangChain 兼容的消息格式 */
export type ChatMessage = { role: 'user' | 'assistant' | 'system' | 'tool'; content: string }
