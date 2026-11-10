import { logger } from '../logger.js'
import { costTracker, checkMonthlyBudget, type AiFeature } from '../costTracker.js'
import { isFreeModel } from '../llm/pricing.js'

/**
 * LangChain 模型初始化（m1 基础）
 * 统一管理 ChatModel 实例，避免重复创建
 *
 * v5 阶段 11：
 *   - feature 标记透传 costTracker（此前硬编码 'chat'，抽取/理解全被记成聊天）
 *   - 小/大模型路由：tier='large' 走 AI_MODEL_LARGE，未配置回退 AI_MODEL
 *   - 月度预算熔断：付费模型调用前检查本月累计，≥100% 强制降级免费档（spec 10.4）
 *   - 429 / 余额不足 → 置全局 degraded 标记，恢复后自动清除
 */

/** 支持的模型类型 */
export type ModelProvider = 'zhipu' | 'openai' | 'mock'

/** 模型初始化配置 */
export interface ModelConfig {
  provider?: ModelProvider
  model?: string
  /** 档位路由：large 优先取 AI_MODEL_LARGE（付费升级档，受预算熔断约束） */
  tier?: 'small' | 'large'
  temperature?: number
  maxTokens?: number
  /** 成本追踪用的功能标签，默认 'chat_general' */
  feature?: AiFeature
}

function getEnv() {
  return {
    apiUrl: process.env.AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.AI_API_KEY || '',
    defaultModel: process.env.AI_MODEL || 'glm-4-flash',
    largeModel: process.env.AI_MODEL_LARGE || '',
  }
}

type ModelEnv = ReturnType<typeof getEnv>

/** LLM 单次请求超时：fetch 不带 signal 时连接挂死会无限等待，拖死整条请求链 */
const LLM_TIMEOUT_MS = Math.max(1000, parseInt(process.env.AI_TIMEOUT_MS || '60000', 10) || 60_000)

/** 429 限流重试延迟：免费档 QPS 窗口短，等几秒大概率恢复；测试环境缩短避免拖慢用例 */
const RETRY_429_DELAY_MS = process.env.VITEST ? 10 : 4000

/** 解析目标模型：显式 model 优先，其次 tier 路由，最后默认免费档 */
export const resolveModelName = (config: ModelConfig, env: ModelEnv = getEnv()): string => {
  if (config.model) return config.model
  if (config.tier === 'large') return env.largeModel || env.defaultModel
  return env.defaultModel
}

// ── 429 / 余额不足降级标记（进程级，成功后自动清除） ──────

export interface ChatDegradedState {
  degraded: boolean
  reason: string | null
  at: number | null
}

let chatDegraded: ChatDegradedState = { degraded: false, reason: null, at: null }

const DEGRADED_PATTERN = /余额不足|1113|insufficient|rate.?limit|too many/i

const markChatDegraded = (reason: string): void => {
  if (!chatDegraded.degraded) {
    logger.warn('llm.degraded', '对话模型进入降级状态（429/余额不足）', { reason })
  }
  chatDegraded = { degraded: true, reason, at: Date.now() }
}

const clearChatDegraded = (): void => {
  if (chatDegraded.degraded) {
    logger.info('llm.degraded', '对话模型恢复正常', { was: chatDegraded.reason })
  }
  chatDegraded = { degraded: false, reason: null, at: null }
}

export const isChatDegraded = (): boolean => chatDegraded.degraded
export const getChatDegradedState = (): ChatDegradedState => ({ ...chatDegraded })

/** 测试用：重置降级状态 */
export const resetChatDegraded = (): void => {
  chatDegraded = { degraded: false, reason: null, at: null }
}

// ── 月度预算熔断（spec 10.4：付费模型调用前检查） ──────────

let lastBudgetWarn = 0

const applyBudgetCircuit = async (
  provider: string,
  model: string,
  env: ModelEnv,
): Promise<{ model: string; downgradedFrom: string | null }> => {
  if (isFreeModel(provider, model)) return { model, downgradedFrom: null }

  const month = await checkMonthlyBudget()
  if (month.blocked && env.defaultModel !== model) {
    logger.warn('llm.budget', '月度预算已用尽，付费模型强制降级为免费档', {
      from: model,
      to: env.defaultModel,
      costYuan: Number(month.costYuan.toFixed(4)),
      budgetYuan: month.budgetYuan,
    })
    return { model: env.defaultModel, downgradedFrom: model }
  }
  if (month.warning && Date.now() - lastBudgetWarn > 60_000) {
    lastBudgetWarn = Date.now()
    logger.warn('llm.budget', `月度预算已用 ${Math.round(month.pct)}%（接近阈值）`, {
      costYuan: Number(month.costYuan.toFixed(4)),
      budgetYuan: month.budgetYuan,
    })
  }
  return { model, downgradedFrom: null }
}

/**
 * 创建 LangChain ChatModel 实例
 * 由于 @langchain/community 未内置智谱集成，这里通过
 * 自定义 Runnable 封装原生 fetch，保持 LangChain 抽象一致性
 */

/** invoke / stream 共享的调用上下文 */
interface ChatCtx {
  env: ModelEnv
  provider: ModelProvider
  temperature: number
  feature: AiFeature
  config: ModelConfig
}

type RawInput = Array<{ role: string; content: string }> | string

/** 带工具调用的请求体（Function Calling） */
interface ToolCallInput {
  messages: Array<{ role: string; content: string }>
  tools: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: object }
  }>
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

/** 解析模型 + 预算熔断 + 组装请求参数 */
const prepareCall = async (ctx: ChatCtx, input: RawInput) => {
  const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input
  const { model, downgradedFrom } = await applyBudgetCircuit(
    ctx.provider,
    resolveModelName(ctx.config, ctx.env),
    ctx.env,
  )
  return { messages, model, downgradedFrom }
}

interface PostChatOpts {
  model: string
  messages: { role: string; content: string }[]
  stream: boolean
  signal?: AbortSignal
  tools?: ToolCallInput['tools']
  toolChoice?: ToolCallInput['toolChoice']
}

const postChat = (ctx: ChatCtx, opts: PostChatOpts) => {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: ctx.temperature,
    stream: opts.stream,
  }
  if (opts.tools) {
    body.tools = opts.tools
    if (opts.toolChoice) body.tool_choice = opts.toolChoice
  }
  return fetch(`${ctx.env.apiUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.env.apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal ?? AbortSignal.timeout(LLM_TIMEOUT_MS),
  })
}

/** 非 2xx 统一处理：日志 + 429/余额不足标记 + throw */
const throwHttpError = async (
  tag: string,
  model: string,
  response: Response,
  costMs: number,
): Promise<never> => {
  const errText = await response.text()
  logger.error(tag, '调用失败', {
    model,
    status: response.status,
    error: errText.slice(0, 200),
    costMs,
  })
  if (response.status === 429 || DEGRADED_PATTERN.test(errText)) {
    markChatDegraded(`HTTP ${response.status}: ${errText.slice(0, 100)}`)
  }
  throw new Error(`AI 请求失败 (${response.status}): ${errText}`)
}

interface TrackUsageOpts {
  model: string
  usage: any
  costMs: number
  downgradedFrom: string | null
}

const trackUsage = (ctx: ChatCtx, opts: TrackUsageOpts): void => {
  costTracker.track({
    feature: ctx.feature,
    model: opts.model,
    provider: ctx.provider,
    promptTokens: opts.usage.prompt_tokens ?? 0,
    completionTokens: opts.usage.completion_tokens ?? 0,
    totalTokens: opts.usage.total_tokens ?? 0,
    costMs: opts.costMs,
    metadata: opts.downgradedFrom ? { budgetDowngradeFrom: opts.downgradedFrom } : undefined,
  })
}

/** 模型调用（非流式） */
const invokeChat = async (ctx: ChatCtx, input: RawInput): Promise<string> => {
  const { messages, model, downgradedFrom } = await prepareCall(ctx, input)
  const t0 = Date.now()

  logger.info('llm.invoke', '调用开始', {
    model,
    messageCount: messages.length,
    maxTokens: ctx.config.maxTokens,
    ...(downgradedFrom ? { budgetDowngrade: downgradedFrom } : {}),
  })

  try {
    // 429 限流重试一次（只重试 HTTP 429，超时/网络错误直接抛）
    let response: Response | undefined
    for (let attempt = 0; attempt <= 1; attempt++) {
      response = await postChat(ctx, { model, messages, stream: false })
      if (response.ok) break
      if (response.status === 429 && attempt < 1) {
        logger.warn('llm.invoke', '429 限流，稍后重试一次', { model, delayMs: RETRY_429_DELAY_MS })
        await new Promise((resolve) => setTimeout(resolve, RETRY_429_DELAY_MS))
        continue
      }
      await throwHttpError('llm.invoke', model, response, Date.now() - t0)
    }

    const data = (await response!.json()) as {
      choices: Array<{ message: { content: string } }>
      usage?: any
    }
    const cost = Date.now() - t0
    logger.info('llm.invoke', '调用完成', { model, costMs: cost, usage: data.usage })
    clearChatDegraded()
    if (data.usage) trackUsage(ctx, { model, usage: data.usage, costMs: cost, downgradedFrom })

    return data.choices[0]?.message?.content || ''
  } catch (err) {
    if ((err as Error).message.startsWith('AI 请求失败')) throw err
    if ((err as Error).name === 'TimeoutError') {
      logger.error('llm.invoke', '调用超时', { model, timeoutMs: LLM_TIMEOUT_MS })
      throw new Error('AI 响应超时，请稍后重试', { cause: err })
    }
    logger.error('llm.invoke', '网络异常', {
      model,
      error: (err as Error).message,
      costMs: Date.now() - t0,
    })
    throw err
  }
}

/**
 * Function Calling 调用：让模型通过工具调用返回结构化 JSON。
 * 返回 tool_calls[0].function.arguments（JSON 字符串），供调用方 parseLooseJson 解析。
 * 若模型未触发工具调用，则回退返回 message.content（兼容 JSON Mode 输出）。
 */
export const invokeChatWithTools = async (
  config: ModelConfig,
  messages: Array<{ role: string; content: string }>,
  tools: ToolCallInput['tools'],
  toolChoice: ToolCallInput['toolChoice'] = 'auto',
): Promise<string> => {
  const ctx: ChatCtx = {
    env: getEnv(),
    provider: config.provider || 'zhipu',
    temperature: config.temperature ?? 0.1,
    feature: config.feature || 'extract',
    config,
  }
  const { model, downgradedFrom } = await applyBudgetCircuit(
    ctx.provider,
    resolveModelName(ctx.config, ctx.env),
    ctx.env,
  )
  const t0 = Date.now()

  logger.info('llm.invoke', 'Function Calling 调用开始', {
    model,
    messageCount: messages.length,
    toolCount: tools.length,
    toolChoice,
  })

  const response = await postChat(ctx, { model, messages, stream: false, tools, toolChoice })
  if (!response.ok) {
    await throwHttpError('llm.invoke', model, response, Date.now() - t0)
  }

  const data = (await response.json()) as {
    choices: Array<{
      message: {
        content: string | null
        tool_calls?: Array<{ function: { name: string; arguments: string } }>
      }
    }>
    usage?: any
  }
  const cost = Date.now() - t0
  logger.info('llm.invoke', 'Function Calling 调用完成', { model, costMs: cost })
  clearChatDegraded()
  if (data.usage) trackUsage(ctx, { model, usage: data.usage, costMs: cost, downgradedFrom })

  const msg = data.choices[0]?.message
  // 优先取工具调用的 arguments；若模型未触发工具则回退到 content
  const toolArgs = msg?.tool_calls?.[0]?.function?.arguments
  if (toolArgs) {
    logger.debug('llm.invoke', 'Function Calling 返回 tool arguments', {
      toolName: msg!.tool_calls![0].function.name,
      argsLen: toolArgs.length,
    })
    return toolArgs
  }
  logger.warn('llm.invoke', '模型未触发工具调用，回退到 content 解析')
  return msg?.content || ''
}

/** 模型调用（流式） */
const streamChat = async function* (
  ctx: ChatCtx,
  input: RawInput,
  options?: { signal?: AbortSignal },
): AsyncGenerator<string> {
  const { messages, model, downgradedFrom } = await prepareCall(ctx, input)
  const t0 = Date.now()

  logger.info('llm.stream', '调用开始', { model, messageCount: messages.length })

  let chunkCount = 0
  try {
    const response = await postChat(ctx, { model, messages, stream: true, signal: options?.signal })
    if (!response.ok) await throwHttpError('llm.stream', model, response, Date.now() - t0)

    const reader = response.body?.getReader()
    if (!reader) {
      logger.error('llm.stream', '无法获取响应流', { model })
      throw new Error('无法获取响应流')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let finishReason = ''
    let streamUsage: any = null // SSE 最后一个 chunk 可能带 usage

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        if (trimmed === 'data: [DONE]') {
          finishReason = 'done'
          break
        }

        try {
          const json = JSON.parse(trimmed.slice(6))
          // 最后几个 chunk 里可能带 usage
          if (json.usage) streamUsage = json.usage
          const delta = json.choices?.[0]?.delta?.content || ''
          if (delta) {
            chunkCount++
            yield delta
          }
        } catch {
          /* ignore */
        }
      }
    }

    const cost = Date.now() - t0
    logger.info('llm.stream', '调用完成', { model, chunkCount, costMs: cost, finishReason })
    clearChatDegraded()
    if (streamUsage) trackUsage(ctx, { model, usage: streamUsage, costMs: cost, downgradedFrom })
  } catch (err) {
    logger.error('llm.stream', '调用异常', {
      model,
      chunkCount,
      error: (err as Error).message,
      costMs: Date.now() - t0,
    })
    throw err
  }
}

export const createChatModel = (config: ModelConfig = {}) => {
  const ctx: ChatCtx = {
    env: getEnv(),
    provider: config.provider || 'zhipu',
    temperature: config.temperature ?? 0.7,
    feature: config.feature || 'chat_general',
    config,
  }

  /**
   * 自定义 Runnable：封装 HTTP 调用为 LangChain Runnable 接口
   * 实现 Runnable.invoke() 接口，保持与 LangChain 链式调用兼容
   */
  return {
    invoke: (input: RawInput) => invokeChat(ctx, input),
    stream: (input: RawInput, options?: { signal?: AbortSignal }) =>
      streamChat(ctx, input, options),

    /** 绑定工具（为 m5 Function Calling 预留接口） */
    bindTools(_tools: Array<{ name: string; description: string; schema: unknown }>) {
      return this
    },
  }
}

/** 类型导出：LangChain 兼容的消息格式 */
export type ChatMessage = { role: 'user' | 'assistant' | 'system' | 'tool'; content: string }
