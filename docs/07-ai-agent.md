# 模块 7：AI Agent 编排

## 学习目标

- 理解 AI Agent 核心架构：Think-Act-Observe 循环与 StateGraph 状态机
- 掌握 LangGraph StateGraph 在 BFF 端的编排模式
- 实现多步推理过程的前端时间线可视化
- 构建支持用户干预（Human-in-the-loop）的 Agent 交互界面

---

## 知识点

### 知识点 1：Agent 基础补充 💡

#### 💡 JS 基础补充

**异步生成器（Async Generator）驱动的事件流**

```typescript
// Agent 执行器使用 async generator 逐步产出事件
async *streamEvents(state: AgentState, input: string) {
  let iteration = 0
  while (iteration < maxIterations) {
    iteration++
    yield { node: 'think', data: { iteration } }
    yield { node: 'call_tools', data: { iteration } }
    yield { node: 'observe', data: { iteration } }
    yield { node: 'answer', data: { content: 'Agent response' } }
    break
  }
}

// 前端消费：逐步渲染时间线
for await (const event of agent.streamEvents(state, task)) {
  addStep({ type: event.node, content: JSON.stringify(event.data) })
}
```

**迭代器协议与可取消迭代**

```typescript
// Agent 执行过程需要支持中断
const controller = new AbortController()

async function runAgent(task: string) {
  for await (const event of agent.streamEvents(initialState, task)) {
    if (controller.signal.aborted) {
      throw new Error('Agent aborted')
    }
    renderStep(event)
  }
}

// 用户点击"中断"
const stop = () => controller.abort()
```

#### 💡 Node 基础补充

**SSE 双向通信：Agent 事件推送 + 用户干预**

```typescript
// BFF Agent SSE 路由：推送事件 + 接收干预
router.post('/agent/run', async (req, res) => {
  const { task, threadId } = req.body

  // 1. 设置 SSE 头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // 2. 启动 Agent 执行
  const agent = createAgentExecutor()
  const state = createInitialState(threadId)

  for await (const event of agent.streamEvents(state, task)) {
    // 3. 逐步推送事件到前端
    res.write(`data: ${JSON.stringify({
      type: 'agent_event',
      node: event.node,
      data: event.data,
      timestamp: Date.now(),
    })}\n\n`)
  }

  res.write(`data: ${JSON.stringify({ type: 'completed' })}\n\n`)
  res.end()
})
```

**Zod Schema 校验工具参数**

```typescript
// apps/server/src/services/tools/registerTools.ts
import { z } from 'zod'

const weatherTool = {
  name: 'get_weather',
  description: '获取指定城市的天气信息',
  schema: z.object({
    city: z.string().describe('城市名称'),
    date: z.string().optional().describe('日期 YYYY-MM-DD'),
  }),
  async execute(args) {
    return { city: args.city, temperature: '22°C', condition: '晴' }
  },
}
```

#### 💡 浏览器基础补充

**Intersection Observer 实现时间线懒渲染**

```typescript
// Agent 时间线可能包含大量步骤
// 使用虚拟滚动 + Intersection Observer 优化
const virtualScroller = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // 懒加载步骤详情（如工具参数、思考过程）
      entry.target.dataset.loaded = 'true'
      virtualScroller.unobserve(entry.target)
    }
  })
})
```

**AbortController 跨组件状态共享**

```typescript
// Vue composable 中维护 AbortController 引用
const controllerRef = ref<AbortController | null>(null)

const startAgent = async (task: string) => {
  controllerRef.value = new AbortController()
  try {
    await runAgent(task, controllerRef.value.signal)
  } catch (e) {
    if (e.name === 'AbortError') {
      status.value = 'aborted'
    }
  } finally {
    controllerRef.value = null
  }
}

const stopAgent = () => {
  controllerRef.value?.abort()
}
```

---

### 知识点 2：AI 场景价值 🤖

**组件生成器的多步推理与自动化任务完成**

Agent 是组件生成器的"自主执行引擎"，从"被动回答"升级为"主动规划执行"：

| 能力 | 传统 Chat | AI Agent | 业务价值 |
|------|----------|----------|---------|
| 组件生成 | 单轮生成代码 | 分析需求 → 选择模板 → 生成 → 校验 → 修复 | 生成成功率从 70% → 95% |
| 模板检索 | 手动指定 | 自动分析需求并检索最匹配的模板 | 减少用户决策负担 |
| 代码修复 | 用户手动描述问题 | 自动发现错误 → 定位 → 修复 → 验证 | 调试效率提升 3 倍 |
| 多框架适配 | 需分别请求 | 一次生成 Vue + React 双版本 | 双端交付效率翻倍 |
| 批量生成 | 逐个请求 | 批量生成多个组件并自动组装 | 页面搭建时间缩短 80% |

**典型场景：组件自动生成 Agent**

```
用户："帮我生成一个商品管理页面，包含商品列表、搜索筛选、分页功能"
  ↓
Agent 自动执行：
  ├─ Step 1（Think）：分析任务需要 3 个组件
  ├─ Step 2（Retrieve）：从模板库检索 ProductList、SearchFilter、Pagination
  ├─ Step 3（Generate）：基于检索到的模板生成 3 个组件代码
  ├─ Step 4（Assemble）：生成页面组装代码，集成 3 个组件
  ├─ Step 5（Validate）：检查组件 Props 是否匹配、事件是否兼容
  └─ Step 6（Answer）：返回完整页面代码 + 组件依赖关系
```

---

### 知识点 3：主线知识点原理解析 📚

#### Agent 核心架构：LangGraph StateGraph

```
┌─────────────────────────────────────────────────────────────┐
│              LangGraph StateGraph 架构                       │
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  START   │───→│    think     │───→│ call_tools   │      │
│  │ (入口)   │    │  (思考节点)  │    │  (工具调用)  │      │
│  └──────────┘    └──────────────┘    └──────┬───────┘      │
│                                               │             │
│                                               ↓             │
│                                        ┌──────────────┐    │
│                                        │   observe    │    │
│                                        │  (观察结果)  │    │
│                                        └──────┬───────┘    │
│                                               │             │
│                                    ┌──────────┴──────────┐ │
│                                    ↓                     ↓ │
│                             ┌──────────────┐      ┌──────────────┐ │
│                             │   answer     │      │    think     │ │
│                             │  (最终回答)  │      │  (继续思考)  │ │
│                             └──────┬───────┘      └──────┬───────┘ │
│                                    │                     │        │
│                                    ↓                     ↓        │
│                             ┌──────────────┐      ┌──────────────┐ │
│                             │    END       │      │  回到        │ │
│                             │  (结束)      │      │ call_tools   │ │
│                             └──────────────┘      └──────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    State（共享状态）                      │   │
│  │  messages | thoughts | toolCalls | status | threadId    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### 状态机节点详解

**① Think 节点** — 分析任务，决定下一步行动

```typescript
// apps/server/src/services/agent/agent.ts
// Think 节点：调用 LLM 分析当前状态
async function thinkNode(state: AgentState): Promise<Partial<AgentState>> {
  const response = await model.invoke([
    { role: 'system', content: '分析当前任务，决定是否需要调用工具' },
    ...state.messages,
  ])

  // 解析思考结果
  const thought = response.content
  const needsTools = response.tool_calls?.length > 0

  return {
    thoughts: [...state.thoughts, thought],
    status: needsTools ? 'waiting_for_tools' : 'answering',
  }
}
```

**② Call Tools 节点** — 执行工具调用

```typescript
async function callToolsNode(state: AgentState): Promise<Partial<AgentState>> {
  const results = []
  for (const toolCall of state.pendingToolCalls) {
    const tool = getTool(toolCall.function.name)
    const result = await tool.execute(JSON.parse(toolCall.function.arguments))
    results.push({
      name: toolCall.function.name,
      args: toolCall.function.arguments,
      result,
    })
  }
  return { toolCalls: [...state.toolCalls, ...results] }
}
```

**③ Observe 节点** — 将工具结果注入上下文

```typescript
async function observeNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastToolCall = state.toolCalls[state.toolCalls.length - 1]
  return {
    messages: [
      ...state.messages,
      { role: 'tool', content: JSON.stringify(lastToolCall.result),
        tool_call_id: lastToolCall.id },
    ],
    status: 'thinking', // 回到思考节点继续推理
  }
}
```

**④ Answer 节点** — 生成最终回答

```typescript
async function answerNode(state: AgentState): Promise<Partial<AgentState>> {
  const response = await model.invoke(state.messages)
  return {
    messages: [...state.messages, { role: 'assistant', content: response.content }],
    status: 'completed',
  }
}
```

#### Agent 状态定义

```typescript
// apps/server/src/services/agent/agent.ts
export interface AgentState {
  threadId: string
  messages: Array<{ role: string; content: string }>
  thoughts: string[]
  toolCalls: Array<{
    name: string
    args: Record<string, unknown>
    result?: unknown
  }>
  status: 'thinking' | 'waiting_for_tools' | 'answering' | 'completed'
  interruptAt?: string  // Human-in-the-loop 中断点
}
```

#### LangGraph StateGraph 编排

```typescript
// 构建 StateGraph
import { StateGraph, END, START } from '@langchain/langgraph'

const graph = new StateGraph(agentStateSchema)

// 添加节点
graph.addNode('think', thinkNode)
graph.addNode('call_tools', callToolsNode)
graph.addNode('observe', observeNode)
graph.addNode('answer', answerNode)

// 添加边
graph.addEdge(START, 'think')
graph.addEdge('think', 'call_tools')        // 有工具调用
graph.addEdge('think', 'answer')            // 无工具调用，直接回答
graph.addEdge('call_tools', 'observe')
graph.addEdge('observe', 'think')           // 继续循环
graph.addEdge('answer', END)

// 条件边：根据状态决定走向
graph.addConditionalEdges('think', (state) => {
  return state.status === 'waiting_for_tools' ? 'call_tools' : 'answer'
})

const app = graph.compile({
  checkpointer: new MemorySaver(),  // 支持暂停/恢复
})
```

---

### 知识点 4：代码实现 💻

#### BFF 端：LangGraph Agent 服务

**`apps/server/src/services/agent/agent.ts`**

```typescript
/**
 * 📚 知识点：Agent StateGraph 编排
 *
 * 🤖 AI 场景价值：组件生成器的自主执行引擎
 * 从被动回答升级为主动规划、多步执行、自动完成复杂任务
 *
 * 💡 Node 基础补充：
 * - Async Generator 逐步产出事件，SSE 推送给前端
 * - Zod Schema 校验工具参数，确保类型安全
 * - AbortController 支持中断执行
 *
 * 📱 C 端生产化改造：
 * 1. Checkpointer 持久化状态，支持刷新后恢复
 * 2. Human-in-the-loop 关键步骤暂停等待确认
 * 3. 最大迭代次数限制 + 超时保护
 */

export interface AgentState {
  threadId: string
  messages: Array<{ role: string; content: string }>
  thoughts: string[]
  toolCalls: Array<{
    name: string
    args: Record<string, unknown>
    result?: unknown
  }>
  status: 'thinking' | 'waiting_for_tools' | 'answering' | 'completed'
  interruptAt?: string
}

export type AgentNode = 'think' | 'call_tools' | 'observe' | 'answer'

export interface AgentConfig {
  maxIterations?: number
  enabledTools?: string[]
  systemPrompt?: string
}

export const createInitialState = (threadId: string): AgentState => ({
  threadId,
  messages: [],
  thoughts: [],
  toolCalls: [],
  status: 'thinking',
})

export const createAgentExecutor = (config: AgentConfig = {}) => {
  const maxIterations = config.maxIterations || 10

  return {
    /** 流式执行 Agent，逐步产出事件 */
    async *streamEvents(
      state: AgentState,
      input: string
    ): AsyncGenerator<{ node: AgentNode; data: unknown }> {
      let currentState = { ...state }
      let iteration = 0

      currentState.messages.push({ role: 'user', content: input })

      while (iteration < maxIterations) {
        iteration++

        // Node 1: Think — 分析任务
        currentState.status = 'thinking'
        yield { node: 'think', data: { iteration } }

        // 模拟调用 LLM 思考 + 决定是否调用工具
        const thought = await analyzeTask(currentState)
        currentState.thoughts.push(thought)

        if (thought.needsTools && currentState.interruptAt !== 'think') {
          // Node 2: Call Tools
          currentState.status = 'waiting_for_tools'
          yield { node: 'call_tools', data: { iteration, tools: thought.tools } }

          const results = await executeTools(thought.tools)
          currentState.toolCalls.push(...results)

          // Node 3: Observe
          currentState.status = 'answering'
          yield { node: 'observe', data: { iteration, results } }

          // 将结果加入消息
          results.forEach(r => {
            currentState.messages.push({
              role: 'tool',
              content: JSON.stringify(r.result),
              tool_call_id: r.id,
            })
          })
        } else {
          // Node 4: Answer — 生成最终回答
          currentState.status = 'completed'
          const answer = await generateAnswer(currentState)
          yield { node: 'answer', data: { content: answer } }

          currentState.messages.push({
            role: 'assistant',
            content: answer,
          })
          break
        }
      }
    },

    /** 回滚到指定步骤 */
    async rollback(_threadId: string, _step: number): Promise<AgentState> {
      throw new Error('rollback 待实现')
    },

    /** 暂停执行（Human-in-the-loop） */
    async pause(_threadId: string): Promise<void> {
      throw new Error('pause 待实现')
    },

    /** 恢复执行 */
    async resume(_threadId: string, _input: string): Promise<AgentState> {
      throw new Error('resume 待实现')
    },
  }
}

/** 分析任务：判断是否需要调用工具 */
async function analyzeTask(state: AgentState) {
  // 实际应调用 LLM：判断任务需要哪些工具
  // 这里简化为基于关键词的规则判断
  const lastUserMsg = [...state.messages].reverse()
    .find(m => m.role === 'user')?.content || ''

  const needsTools = /(搜索|查找|列表|筛选|分页|模板|组件)/.test(lastUserMsg)

  if (needsTools) {
    return {
      needsTools: true,
      tools: [{
        name: 'search_components',
        args: { keyword: extractKeywords(lastUserMsg) },
      }],
    }
  }
  return { needsTools: false, tools: [] }
}

/** 执行工具调用 */
async function executeTools(tools: Array<{ name: string; args: Record<string, unknown> }>) {
  const results = []
  for (const tool of tools) {
    const handler = toolHandlers[tool.name]
    const result = handler
      ? await handler(tool.args)
      : { error: `工具 ${tool.name} 未注册` }
    results.push({ id: crypto.randomUUID(), ...tool, result })
  }
  return results
}

/** 工具处理器注册表 */
const toolHandlers: Record<string, (args: any) => Promise<unknown>> = {
  async search_components(args: { keyword: string }) {
    // 从模板库检索组件
    const results = await vectorSearch(args.keyword, { topK: 3 })
    return { components: results.map(r => ({
      name: r.doc.name,
      path: r.doc.path,
      score: r.score,
    })) }
  },

  async generate_component(args: { type: string; templateId?: string }) {
    // 基于模板生成组件代码
    const code = await generateFromTemplate(args.type, args.templateId)
    return { code, language: 'vue' }
  },

  async validate_component(args: { code: string }) {
    // 校验组件代码
    const issues = validateVueComponent(args.code)
    return { valid: issues.length === 0, issues }
  },
}

/** 生成最终回答 */
async function generateAnswer(state: AgentState): Promise<string> {
  // 实际应调用 LLM 基于所有上下文生成回答
  const toolResults = state.toolCalls.map(t =>
    `${t.name}: ${JSON.stringify(t.result)}`
  ).join('\n')

  return `Agent 执行完成。\n\n执行步骤：${state.thoughts.length} 步\n工具调用：${state.toolCalls.length} 次\n\n结果摘要：\n${toolResults}`
}
```

**`apps/server/src/routes/agent.ts`**

```typescript
/**
 * Agent 执行 SSE 路由
 * POST /api/agent/run — 启动 Agent 执行
 * DELETE /api/agent/run — 中断 Agent 执行
 * POST /api/agent/resume — 恢复执行（Human-in-the-loop）
 */

import { Router } from 'express'
import { createAgentExecutor, createInitialState } from '../services/agent/agent.js'

const router = Router()
const activeSessions = new Map<string, {
  cancel: () => void
  events: Array<{ node: string; data: unknown; timestamp: number }>
}>()

/** POST /api/agent/run */
router.post('/run', async (req, res) => {
  try {
    const { task, threadId } = req.body as {
      task: string
      threadId?: string
    }
    if (!task?.trim()) {
      res.status(400).json({ error: '请输入任务描述' })
      return
    }

    const id = threadId || crypto.randomUUID()
    const agent = createAgentExecutor({ maxIterations: 8 })
    const state = createInitialState(id)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    // 注册会话（支持中断）
    const session = {
      cancel: () => { res.destroy() },
      events: [],
    }
    activeSessions.set(id, session)

    let stepCount = 0
    for await (const event of agent.streamEvents(state, task)) {
      stepCount++
      const payload = {
        type: 'agent_event',
        step: stepCount,
        node: event.node,
        data: event.data,
        timestamp: Date.now(),
      }
      session.events.push(payload)
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    // 发送完成事件
    res.write(`data: ${JSON.stringify({
      type: 'completed',
      threadId: id,
      totalSteps: stepCount,
    })}\n\n`)
    activeSessions.delete(id)
    res.end()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent 执行失败'
    if (!res.headersSent) {
      res.status(500).json({ error: message })
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
      res.end()
    }
  }
})

/** DELETE /api/agent/run — 中断执行 */
router.delete('/run/:threadId', (req, res) => {
  const session = activeSessions.get(req.params.threadId)
  if (session) {
    session.cancel()
    activeSessions.delete(req.params.threadId)
    res.json({ success: true })
  } else {
    res.status(404).json({ error: '会话不存在' })
  }
})

/** POST /api/agent/resume — Human-in-the-loop 恢复 */
router.post('/resume/:threadId', async (req, res) => {
  const { input } = req.body as { input: string }
  // 实际应调用 agent.resume(threadId, input)
  res.json({ success: true, message: '恢复执行待实现' })
})

export default router
```

#### 前端：Vue3 + Nuxt3 Agent Composable

**`apps/web-vue-nuxt/composables/useAgent.ts`**

```typescript
/**
 * 📚 知识点：useAgent Composable — Agent 状态管理
 *
 * 🤖 AI 场景价值：组件生成器的"执行控制器"
 * 管理 Agent 执行过程中的步骤状态、中断恢复、用户干预
 *
 * 💡 JS 基础补充：
 * - 模块级单例状态（与 useChat/useRag 一致）
 * - AbortController 中断 + 恢复模式
 * - 步骤数组累积 + 实时渲染
 *
 * 💡 浏览器基础补充：
 * - SSE 流式解析：逐步接收 Agent 事件
 * - requestAnimationFrame 批量更新 DOM
 *
 * 📱 C 端生产化改造：
 * 1. 步骤虚拟化渲染（>100 步时启用虚拟滚动）
 * 2. 执行过程本地缓存，刷新可恢复
 * 3. 步骤耗时统计，性能分析
 *
 * 🤝 与 React 对照：
 * Vue useAgent() ↔ React useAgent Hook
 * Vue ref()     ↔ React useState()
 * Vue computed  ↔ React useMemo
 */

import { ref, computed } from 'vue'

export type StepType = 'thinking' | 'tool_call' | 'tool_result' | 'final_answer'
export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted'

export interface AgentStep {
  id: string
  type: StepType
  content: string
  toolName?: string
  toolArgs?: string
  isError?: boolean
  timestamp: number
  duration?: number
}

// ====== 模块级单例状态 ======
const steps = ref<AgentStep[]>([])
const status = ref<AgentStatus>('idle')
const error = ref('')
const streamingContent = ref('')
const controllerRef = ref<AbortController | null>(null)
const currentThreadId = ref('')

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useAgent() {
  const isRunning = computed(() => status.value === 'running')
  const isCompleted = computed(() => status.value === 'completed')
  const isAborted = computed(() => status.value === 'aborted')

  /** 添加步骤 */
  const addStep = (step: Omit<AgentStep, 'id' | 'timestamp'>): string => {
    const id = generateId()
    const newStep: AgentStep = { ...step, id, timestamp: Date.now() }
    steps.value.push(newStep)
    return id
  }

  /** 更新指定步骤 */
  const updateStep = (stepId: string, content: string) => {
    const step = steps.value.find(s => s.id === stepId)
    if (step) {
      step.content = content
    }
  }

  /** 开始 Agent 执行 */
  const startAgent = async (task: string) => {
    if (!task.trim() || isRunning.value) return

    steps.value = []
    error.value = ''
    streamingContent.value = ''
    status.value = 'running'

    const controller = new AbortController()
    controllerRef.value = controller

    addStep({ type: 'thinking', content: '正在分析任务...' })

    try {
      const config = useRuntimeConfig()
      const response = await fetch(
        `${config.public.bffUrl}/api/agent/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task }),
          signal: controller.signal,
        }
      )

      if (!response.ok) throw new Error(`请求失败: ${response.status}`)

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法获取响应流')

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
          if (!trimmed || !trimmed.startsWith('data:')) continue

          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue

          try {
            const json = JSON.parse(data)

            switch (json.type) {
              case 'agent_event':
                handleAgentEvent(json)
                break
              case 'completed':
                status.value = 'completed'
                break
              case 'error':
                error.value = json.error
                status.value = 'failed'
                break
            }
          } catch { /* 忽略解析错误 */ }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        status.value = 'aborted'
      } else {
        error.value = err instanceof Error ? err.message : 'Agent 执行失败'
        status.value = 'failed'
      }
    } finally {
      controllerRef.value = null
    }
  }

  /** 处理 Agent 事件 */
  const handleAgentEvent = (event: {
    step: number
    node: string
    data: unknown
  }) => {
    const { node, data } = event

    switch (node) {
      case 'think':
        addStep({
          type: 'thinking',
          content: `第 ${event.step} 步：分析任务中...`,
        })
        break

      case 'call_tools': {
        const toolData = data as { tools: Array<{ name: string; args: Record<string, unknown> }> }
        toolData.tools.forEach(tool => {
          addStep({
            type: 'tool_call',
            content: `调用 ${tool.name}`,
            toolName: tool.name,
            toolArgs: JSON.stringify(tool.args),
          })
        })
        break
      }

      case 'observe': {
        const resultData = data as { results: Array<{ result: unknown }> }
        resultData.results.forEach(r => {
          addStep({
            type: 'tool_result',
            content: typeof r.result === 'string'
              ? r.result
              : JSON.stringify(r.result),
            isError: false,
          })
        })
        break
      }

      case 'answer': {
        const answerData = data as { content: string }
        addStep({
          type: 'final_answer',
          content: answerData.content,
        })
        streamingContent.value = answerData.content
        break
      }
    }
  }

  /** 中断 Agent 执行 */
  const stopAgent = () => {
    controllerRef.value?.abort()
  }

  /** 重置状态 */
  const resetAgent = () => {
    steps.value = []
    status.value = 'idle'
    error.value = ''
    streamingContent.value = ''
    controllerRef.value?.abort()
  }

  return {
    steps,
    status,
    error,
    streamingContent,
    isRunning,
    isCompleted,
    isAborted,
    startAgent,
    stopAgent,
    resetAgent,
  }
}
```

#### 前端页面：Agent 执行时间线

**`apps/web-vue-nuxt/pages/agent.vue`**

```vue
<script setup lang="ts">
/**
 * 📚 知识点：Agent 执行页面 + 时间线可视化
 *
 * 🤖 AI 场景价值：组件生成器的"自动执行面板"
 * 用户描述高层任务，Agent 自动规划并执行，
 * 前端实时展示每一步的思考、工具调用、执行结果
 *
 * 💡 Vue3 基础补充：
 * - 动态组件：根据 step.type 渲染不同的步骤卡片
 * - Transition 动画：新步骤淡入效果
 * - ref + watch 实现自动滚动到底部
 *
 * 📱 C 端生产化改造：
 * 1. 步骤虚拟化渲染（>100 步虚拟滚动）
 * 2. 执行时长统计与性能面板
 * 3. 步骤折叠/展开（思考过程可隐藏）
 */

import { useAgent, type AgentStep } from '~/composables/useAgent'

const agent = useAgent()
const {
  steps, status, error, streamingContent,
  isRunning, isCompleted, isAborted,
  startAgent, stopAgent, resetAgent,
} = agent

const task = ref('')
const showThinking = ref(true)
const bottomRef = ref<HTMLElement | null>(null)

const EXAMPLE_TASKS = [
  '生成一个商品管理页面，包含列表、搜索筛选、分页功能',
  '对比 Vue2 和 Vue3 的响应式原理，用代码演示',
  '实现一个带防抖的搜索组件，并说明防抖原理',
]

/** 步骤类型样式映射 */
const stepStyles: Record<string, { label: string; icon: string; color: string }> = {
  thinking:    { label: '思考', icon: '💭', color: 'text-indigo-500 bg-indigo-500/10' },
  tool_call:   { label: '调用工具', icon: '🔧', color: 'text-cyan-500 bg-cyan-500/10' },
  tool_result: { label: '执行结果', icon: '✅', color: 'text-emerald-500 bg-emerald-500/10' },
  final_answer:{ label: '最终回答', icon: '🎯', color: 'text-purple-500 bg-purple-500/10' },
}

const getStepStyle = (step: AgentStep) => {
  if (step.type === 'tool_result' && step.isError) {
    return { label: '执行失败', icon: '❌', color: 'text-rose-500 bg-rose-500/10' }
  }
  return stepStyles[step.type] || { label: '', icon: '•', color: 'text-slate-400' }
}

/** 计算步骤耗时 */
const getStepDuration = (step: AgentStep, index: number) => {
  if (index === steps.value.length - 1 && isRunning.value) return null
  const nextStep = steps.value[index + 1]
  if (!nextStep) return null
  return ((nextStep.timestamp - step.timestamp) / 1000).toFixed(1)
}

/** 提交任务 */
const handleSubmit = () => {
  const trimmed = task.value.trim()
  if (!trimmed || isRunning.value) return
  startAgent(trimmed)
  task.value = ''
}

/** 自动滚动到底部 */
watch(() => steps.value.length, async () => {
  await nextTick()
  bottomRef.value?.scrollIntoView({ behavior: 'smooth' })
})

onMounted(() => {
  // 页面加载时的初始化
})
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">
    <h1 class="text-xl font-bold text-slate-800 mb-1">AI Agent 编排</h1>
    <p class="text-sm text-slate-500 mb-6">
      描述高层任务，Agent 自动规划执行步骤，实时展示执行过程
    </p>

    <!-- 任务输入 -->
    <div class="mb-4">
      <textarea
        v-model="task"
        class="w-full h-24 p-3 rounded-xl border border-slate-200 text-sm resize-none focus:border-brand-400 focus:outline-none"
        placeholder="描述一个需要多步骤完成的任务...&#10;例如：生成商品管理页面"
        :disabled="isRunning"
        @keydown.enter.exact.prevent="handleSubmit"
      />
    </div>

    <!-- 示例任务 -->
    <div v-if="!isRunning && steps.length === 0" class="mb-4">
      <div class="text-xs text-slate-500 mb-2">试试这些任务：</div>
      <div class="space-y-2">
        <button
          v-for="example in EXAMPLE_TASKS"
          :key="example"
          class="w-full px-3 py-2.5 text-left text-xs bg-slate-50 text-slate-600 rounded-lg border border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all"
          @click="task = example"
        >{{ example }}</button>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="flex gap-2 mb-4">
      <button
        class="flex-1 h-10 rounded-xl bg-brand-500 text-white text-sm font-medium transition-all hover:shadow-md disabled:opacity-40"
        :disabled="isRunning || !task.trim()"
        @click="handleSubmit"
      >
        {{ isRunning ? '执行中...' : '开始执行' }}
      </button>
      <button
        v-if="isRunning"
        class="h-10 px-4 border border-rose-300 text-rose-500 rounded-xl text-sm hover:bg-rose-50 transition-colors"
        @click="stopAgent"
      >中断</button>
      <button
        v-if="isCompleted || status === 'failed' || isAborted"
        class="h-10 px-4 border border-slate-300 text-slate-500 rounded-xl text-sm hover:bg-slate-50 transition-colors"
        @click="resetAgent"
      >重置</button>
    </div>

    <!-- 状态指示器 -->
    <div v-if="status !== 'idle'" class="mb-4 flex items-center gap-2">
      <div
        class="w-2 h-2 rounded-full"
        :class="isRunning ? 'bg-indigo-500 animate-pulse' :
                isCompleted ? 'bg-emerald-500' :
                isAborted ? 'bg-amber-500' : 'bg-rose-500'"
      />
      <span
        class="text-xs"
        :class="isRunning ? 'text-indigo-500' :
                 isCompleted ? 'text-emerald-500' :
                 isAborted ? 'text-amber-500' : 'text-rose-500'"
      >
        {{ isRunning ? '执行中' :
           isCompleted ? '已完成' :
           isAborted ? '已中断' : '已失败' }}
      </span>
      <span class="text-xs text-slate-400 ml-auto">
        {{ steps.length }} 步
      </span>
      <button
        v-if="steps.length > 0"
        class="text-xs text-slate-400 hover:text-slate-600"
        @click="showThinking = !showThinking"
      >{{ showThinking ? '隐藏思考' : '显示思考' }}</button>
    </div>

    <!-- 错误提示 -->
    <div
      v-if="error"
      class="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-600"
    >{{ error }}</div>

    <!-- Agent 执行时间线 -->
    <div v-if="steps.length > 0" class="relative pl-6">
      <!-- 垂直连接线 -->
      <div class="absolute left-[11px] top-3 bottom-3 w-px bg-slate-200" />

      <!-- 步骤列表 -->
      <div class="space-y-3">
        <transition-group name="step" tag="div" class="space-y-3">
          <div
            v-for="(step, index) in steps"
            :key="step.id"
            class="relative"
          >
            <!-- 节点圆点 -->
            <div
              class="absolute -left-6 top-1 w-[22px] h-[22px] rounded-full flex items-center justify-center text-xs"
              :class="[
                getStepStyle(step).color,
                isRunning && index === steps.length - 1 ? 'animate-pulse' : '',
              ]"
            >
              {{ getStepStyle(step).icon }}
            </div>

            <!-- 内容卡片 -->
            <div
              class="rounded-xl p-3 border transition-all"
              :class="step.type === 'final_answer'
                ? 'bg-gradient-card border-brand-200'
                : 'bg-white border-slate-200'"
            >
              <div class="flex items-center gap-2 mb-1">
                <span
                  class="text-xs font-medium"
                  :class="getStepStyle(step).color.split(' ')[0]"
                >{{ getStepStyle(step).label }}</span>
                <span v-if="step.toolName" class="text-xs text-slate-400">
                  · {{ step.toolName }}
                </span>
                <span class="text-xs text-slate-300 ml-auto">
                  {{ getStepDuration(step, index) }}s
                </span>
              </div>

              <!-- 思考过程（可隐藏） -->
              <div
                v-if="step.type === 'thinking' && showThinking"
                class="text-sm text-slate-500 whitespace-pre-wrap"
              >{{ step.content }}</div>

              <!-- 工具调用 -->
              <div
                v-else-if="step.type === 'tool_call'"
                class="text-sm text-slate-700"
              >
                {{ step.content }}
                <div
                  v-if="step.toolArgs"
                  class="mt-1 text-xs text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded"
                >参数：{{ step.toolArgs }}</div>
              </div>

              <!-- 工具结果 -->
              <div
                v-else-if="step.type === 'tool_result'"
                class="text-sm text-slate-700 whitespace-pre-wrap break-words"
                :class="{ 'text-rose-500': step.isError }"
              >{{ step.content }}</div>

              <!-- 最终回答 -->
              <div
                v-else-if="step.type === 'final_answer'"
                class="text-sm text-slate-800 whitespace-pre-wrap"
              >{{ step.content }}</div>
            </div>
          </div>
        </transition-group>

        <!-- 滚动锚点 -->
        <div ref="bottomRef" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-enter-active {
  transition: all 0.3s ease;
}
.step-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
```

---

### 知识点 5：C 端生产化改造 📱

| 维度 | 改造项 | 方案 |
|------|--------|------|
| **执行可靠性** | Checkpointer 持久化 | Redis 存储 Agent 状态，服务重启后可恢复 |
| **执行可靠性** | 超时保护 | 单步超时 30s 自动跳过，整体超时 5min 终止 |
| **执行可靠性** | 最大步骤限制 | 防止 Agent 陷入无限循环（默认 8 步） |
| **用户体验** | 步骤虚拟化 | >100 步启用虚拟滚动，仅渲染可视区域 |
| **用户体验** | 耗时统计 | 每步耗时显示 + 总耗时统计 |
| **用户体验** | 思考过程折叠 | 默认隐藏思考过程，可展开查看 |
| **用户体验** | 执行回放 | 支持查看历史 Agent 执行过程 |
| **交互增强** | Human-in-the-loop | 关键步骤暂停，用户确认后继续 |
| **交互增强** | 步骤编辑 | 允许修改 Agent 的下一步计划 |
| **交互增强** | 分支执行 | 从中间步骤分叉，尝试不同方案 |

**超时保护示例**

```typescript
// apps/server/src/services/agent/agent.ts
const createAgentExecutor = (config: AgentConfig = {}) => {
  const maxIterations = config.maxIterations || 8
  const stepTimeout = config.stepTimeout || 30000

  return {
    async *streamEvents(state: AgentState, input: string) {
      for (let i = 0; i < maxIterations; i++) {
        const stepPromise = runStep(state, i)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('step timeout')), stepTimeout)
        )

        try {
          const result = await Promise.race([stepPromise, timeoutPromise])
          yield result
        } catch (err) {
          yield { node: 'answer', data: { content: `步骤 ${i + 1} 超时，已终止执行` } }
          break
        }
      }
    },
  }
}
```

**Human-in-the-loop 示例**

```typescript
// 在生成组件代码前暂停，等待用户确认
async function generateComponentNode(state: AgentState) {
  const code = await generateFromTemplate(state.currentTask, state.templateId)

  // 暂停，让用户确认
  state.interruptAt = 'confirm_generation'
  state.pendingCode = code

  return { status: 'waiting_for_user', pendingCode: code }
}

// 前端收到等待确认的事件
case 'waiting_for_user':
  showConfirmModal({
    code: event.data.pendingCode,
    onConfirm: () => resumeAgent(threadId, { confirmed: true }),
    onEdit: (editedCode) => resumeAgent(threadId, { editedCode }),
    onCancel: () => abortAgent(threadId),
  })
  break
```

---

### 知识点 6：与 React 对照 🤝

| 维度 | Vue3 + Nuxt3 实现 | React 实现 |
|------|-------------------|------------|
| **状态管理** | `ref()` + 模块级单例 | `useState()` + useRef 保存 AbortController |
| **步骤渲染** | `v-for` + `transition-group` 动画 | `.map()` + CSS transition |
| **自动滚动** | `watch()` + `nextTick()` + `scrollIntoView` | `useEffect()` + `scrollIntoView` |
| **SSE 解析** | `TextDecoder` + buffer split | 同 Vue |
| **中断机制** | `AbortController` + `ref` 引用 | `AbortController` + `useRef` |
| **类型定义** | 独立 `types.ts` 或内联 | 独立 `types.ts` |
| **图标方案** | Emoji + CSS | antd-mobile-icons / lucide-react |
| **样式方案** | Tailwind + `<style scoped>` | Tailwind + CSS modules |

**对照代码：时间线组件**

```typescript
// ===== React 版 (apps/web-react/src/modules/07-agent/AgentTimeline.tsx) =====
import { SmileOutline, SetOutline } from 'antd-mobile-icons'

const AgentTimeline: React.FC<{ steps: AgentStep[] }> = ({ steps }) => {
  return (
    <div className="relative pl-6">
      <div className="absolute left-[11px] w-px bg-slate-700" />
      {steps.map(step => (
        <div key={step.id} className="relative">
          <div className="absolute -left-6 w-[22px] h-[22px] rounded-full">
            {step.type === 'thinking' ? <SmileOutline /> : <SetOutline />}
          </div>
          <div className="glass-card rounded-lg p-3">
            <div className="text-sm">{step.content}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ===== Vue 版 (apps/web-vue-nuxt/pages/agent.vue) =====
<template>
  <div class="relative pl-6">
    <div class="absolute left-[11px] w-px bg-slate-200" />
    <transition-group name="step" tag="div" class="space-y-3">
      <div v-for="step in steps" :key="step.id" class="relative">
        <div class="absolute -left-6 w-[22px] h-[22px] rounded-full">
          {{ getStepStyle(step).icon }}
        </div>
        <div class="rounded-xl p-3 bg-white border border-slate-200">
          <div class="text-sm">{{ step.content }}</div>
        </div>
      </div>
    </transition-group>
  </div>
</template>
```

**核心差异**：React 版本使用 antd-mobile-icons 组件库提供专业图标；Vue 版本使用 Emoji + CSS 实现，更轻量。React 的 `transition-group` 对应 Vue 的 `<transition-group>`，实现步骤添加/删除的动画效果。

---

### 知识点 7：面试题 / 常见坑 🧠

#### AI 产品场景题（≥ 80%）

**Q1：组件生成器中，Agent 相比纯 Chat 模式有哪些优势？**
> 答：
> | 维度 | Chat 模式 | Agent 模式 |
> |------|----------|-----------|
> | 组件生成 | 单轮生成，出错需用户修正 | 自动检查 → 修复 → 验证 |
> | 模板检索 | 用户手动选择模板 | 自动分析需求并匹配模板 |
> | 多组件 | 逐个生成，手动组装 | 批量生成 + 自动组装 + 依赖检查 |
> | 错误处理 | 用户发现错误并反馈 | 自动发现 → 定位 → 修复 |
> | 双框架 | 分别请求 Vue/React | 一次生成双版本 |
>
> 数据支撑：Agent 模式生成成功率从 70% → 95%，用户操作步骤从 5 步 → 1 步。

**Q2：LangGraph StateGraph 的核心设计理念是什么？**
> 答：
> 1. **状态显式化**：所有 Agent 状态（messages、thoughts、toolCalls）存储在共享 State 中，每个节点接收 State、返回 Partial State 更新
> 2. **图结构**：节点 + 边 + 条件边，清晰表达执行流程，支持循环和分支
> 3. **可中断**：Checkpointer 持久化状态，支持暂停/恢复/回滚
> 4. **可组合**：支持子图嵌套，复杂 Agent 可拆为多个子图
> 5. **事件驱动**：每个节点产出事件，前端可实时渲染执行过程
>
> 与传统 Workflow（如 Camunda）的区别：LLM 驱动决策 → 条件边由模型输出决定，而非硬编码规则。

**Q3：Agent 如何避免无限循环？**
> 答：
> 三重保护机制：
> 1. **最大迭代次数**（max_iterations）：默认 8 步，防止死循环
> 2. **超时保护**：单步 30s 超时，整体 5min 超时
> 3. **重复检测**：如果连续 2 步的状态没有变化（thoughts + toolCalls 未增加），自动终止
>
> LangGraph 内置 `recursion_limit` 参数：`graph.compile({ recursionLimit: 20 })`

**Q4：Human-in-the-loop 在组件生成器中如何应用？**
> 答：
> 典型的 3 个干预点：
> 1. **模板选择确认**：Agent 检索到 Top-3 模板后暂停，用户确认/修改选择
> 2. **代码生成确认**：生成组件代码后暂停，用户可编辑或要求重新生成
> 3. **错误修复确认**：自动修复代码后暂停，用户确认修改内容
>
> 实现方式：LangGraph 的 `interrupt_before`/`interrupt_after` + `Command(resume=...)` API
>
> ```typescript
> // 生成前暂停
> graph.addNode('generate', generateNode, {
>   interruptBefore: ['confirm'], // 在 generate 节点前暂停
> })
> ```

**Q5：Agent 执行过程中前端如何优化用户体验？**
> 答：
> 1. **逐步渲染**：新步骤立即显示，不等待全部完成
> 2. **自动滚动**：新步骤加入时自动滚动到底部
> 3. **思考折叠**：默认隐藏思考过程（避免信息过载），可展开查看
> 4. **耗时显示**：每步耗时 + 总耗时统计，感知性能
> 5. **错误可视化**：失败步骤用红色标记，成功用绿色
> 6. **进度预估**：基于已执行步数/最大步数显示进度
> 7. **离线恢复**：刷新页面后从最近的 Checkpoint 恢复
>
> 关键原则：**让用户感知到 Agent 在"做事"，而不是"卡住了"**。

**Q6：如何评估 Agent 的执行质量？**
> 答：
> 四个核心维度：
> 1. **任务完成率**：Agent 是否成功完成用户指定的任务 → 离线评估
> 2. **步骤效率**：完成任务的平均步骤数（越少越好）→ 离线评估
> 3. **工具准确率**：调用的工具是否正确、参数是否准确 → 人工评估
> 4. **用户满意度**：用户对最终结果的评分 → 在线反馈
>
> 进阶评估：
> - **Trace 可视化**：LangSmith / LangFuse 记录每步执行，支持回放分析
> - **A/B 测试**：对比不同 Agent 配置的效果
> - **失败分类**：统计失败原因（超时、工具错误、模型幻觉等）

#### 常见坑

**坑 1：Agent 陷入重复思考循环**

```typescript
// ❌ 错误：while 循环无退出条件
while (true) {
  const thought = await think(state)
  // 没有 break 条件
}

// ✅ 正确：设置最大迭代 + 状态变化检测
let iteration = 0
while (iteration < maxIterations) {
  iteration++
  const prevThoughts = state.thoughts.length
  const thought = await think(state)
  if (state.thoughts.length === prevThoughts) break
}
```

**坑 2：工具调用参数未校验**

```typescript
// ❌ 错误：直接使用模型返回的工具参数
const result = await tool.execute(JSON.parse(toolCall.arguments))

// ✅ 正确：用 Zod Schema 校验后再执行
const validated = tool.schema.parse(JSON.parse(toolCall.arguments))
const result = await tool.execute(validated)
```

**坑 3：SSE 连接未正确清理**

```typescript
// ❌ 错误：忘记在 abort 后清理 reader
const reader = response.body.getReader()
controller.signal.addEventListener('abort', () => {
  // reader 未被取消，内存泄漏
})

// ✅ 正确：abort 时释放资源
let reader: ReadableStreamDefaultReader | null = null
try {
  reader = response.body!.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
} finally {
  reader?.releaseLock?.()
  reader?.cancel?.()
}
```

**坑 4：Agent 状态在服务重启后丢失**

```typescript
// ❌ 错误：状态只存在内存中
const sessions = new Map<string, AgentState>() // 重启丢失

// ✅ 正确：使用 Checkpointer 持久化
import { MemorySaver } from '@langchain/langgraph'
const checkpointer = new MemorySaver() // 生产用 RedisSaver
const app = graph.compile({ checkpointer })

// 执行时自动保存状态
await app.invoke(input, { configurable: { thread_id: 'xxx' } })
// 重启后可恢复
await app.invoke(Command(resume='yes'), { configurable: { thread_id: 'xxx' } })
```

**坑 5：前端步骤渲染性能问题**

```typescript
// ❌ 错误：每收到一个事件就触发全量重渲染
for await (const event of agent.streamEvents()) {
  steps.value.push(transform(event)) // 每次 push 触发重渲染
}

// ✅ 正确：批量更新 + 虚拟滚动
const batch: AgentStep[] = []
const flush = () => {
  steps.value.push(...batch.splice(0))
}
for await (const event of agent.streamEvents()) {
  batch.push(transform(event))
  if (batch.length >= 5) flush()
}
flush()

// 步骤超过 100 时启用虚拟滚动
const virtualSteps = computed(() =>
  steps.value.length > 100
    ? steps.value.slice(visibleRange.value.start, visibleRange.value.end)
    : steps.value
)
```

---

## 实践任务

### 任务 1：Agent 执行时间线

- [ ] 实现 Think → Act → Observe → Answer 循环可视化
- [ ] 每步用卡片展示（步骤类型图标 + 内容）
- [ ] 实时追加新步骤 + 自动滚动
- [ ] 显示每步耗时

### 任务 2：多工具编排

- [ ] 注册至少 3 个工具（搜索组件、生成组件、校验组件）
- [ ] Agent 能根据任务自动选择调用顺序
- [ ] 工具调用失败时能回退尝试

### 任务 3：用户干预机制

- [ ] 关键步骤暂停等待用户确认
- [ ] 用户可修改 Agent 的下一步计划
- [ ] 支持中断执行 + 重置
- [ ] 支持从中间步骤恢复执行

### 任务 4（进阶）：组件自动生成 Agent

- [ ] 接收高层任务（如"生成商品管理页面"）
- [ ] 自动拆分为多组件生成任务
- [ ] 生成后自动组装 + 校验
- [ ] 输出完整页面代码 + 组件依赖关系

---

## 检验标准

- [ ] 理解 Agent Think-Act-Observe 循环与 LangGraph StateGraph
- [ ] 能可视化展示 Agent 的多步执行过程
- [ ] 实现 BFF 端 LangGraph 编排 + SSE 事件推送
- [ ] 支持用户在执行中干预（暂停/恢复/修改）
- [ ] 能回答 Agent 相比 Chat 的优势与差异
- [ ] 能说明 LangGraph StateGraph 的 5 个核心设计理念
- [ ] 能设计 Agent 的无限循环防护机制
- [ ] 能实现 Human-in-the-loop 的 3 个典型干预点

---

## 参考代码结构

```
apps/
├── server/
│   └── src/
│       ├── routes/
│       │   └── agent.ts            # Agent SSE 路由（run/resume/stop）
│       ├── services/
│       │   ├── agent/
│       │   │   └── agent.ts        # StateGraph 编排 + 执行器
│       │   └── tools/
│       │       └── registerTools.ts # 工具注册表（Zod Schema）
│       └── chain/
│           ├── chatChain.ts        # LangChain 链式调用
│           └── model.ts            # LLM 模型封装
│
├── web-vue-nuxt/
│   ├── composables/
│   │   └── useAgent.ts             # Agent Composable（状态 + SSE）
│   └── pages/
│       └── agent.vue               # Agent 执行页面 + 时间线
│
└── web-react/
    └── src/modules/07-agent/
        ├── AgentPage.tsx           # Agent 主页
        ├── AgentTimeline.tsx       # 执行时间线组件
        ├── useAgent.ts             # Agent Hook
        └── types.ts                # 类型定义
```