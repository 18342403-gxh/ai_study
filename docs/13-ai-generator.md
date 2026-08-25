# Phase 10：AI 组件生成器 — 产品主线实现

## 学习目标

- 理解 AI 组件生成器的整体架构：从用户需求到生成可用组件的完整流水线
- 掌握 Generator Agent 的 5 节点编排：clarify → retrieve → generate → preview → iterate
- 实现 Prompt 模板的动态组装：根据用户需求 + 检索结果 + 系统指令
- 构建代码预览与编辑体验：Monaco Editor、实时预览、沙箱执行
- 理解迭代优化机制：用户反馈 → Prompt 调整 → 重新生成 → 逐步收敛

---

## 知识点

### 10.1 Generator Agent 编排层

#### 💡 JS 基础补充 A.14：Discriminated Union 类型安全

Generator 的状态流转使用判别联合类型，确保每个节点的状态类型安全：

```typescript
// 每个节点有自己的状态结构
type GeneratorState =
  | { phase: 'idle' }
  | { phase: 'clarify'; question: string; options: string[] }
  | { phase: 'retrieve'; query: string; results: Template[] }
  | { phase: 'generate'; prompt: string; code: string }
  | { phase: 'preview'; code: string; errors: string[] }
  | { phase: 'iterate'; feedback: string; history: string[] }
  | { phase: 'completed'; finalCode: string }
  | { phase: 'failed'; error: string }

// TypeScript 自动根据 phase 字段推断其他字段的类型
function handleState(state: GeneratorState) {
  switch (state.phase) {
    case 'clarify':
      // 这里 state 自动有 question 和 options
      console.log(state.question, state.options)
      break
    case 'completed':
      // 这里 state 自动有 finalCode
      downloadCode(state.finalCode)
      break
  }
}
```

#### 💡 Node 基础补充 C.12：Worker Threads 与沙箱

代码预览需要沙箱执行生成的代码，用 Worker Threads 隔离：

```typescript
// apps/server/src/services/generator/sandbox.ts
import { Worker } from 'worker_threads'

// 用 Worker Threads 隔离执行用户代码
export function executeInSandbox(code: string, timeout = 5000): Promise<{
  success: boolean
  output?: string
  errors?: string[]
}> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./sandbox-worker.js', import.meta.url),
      { workerData: { code, timeout } }
    )
    const timer = setTimeout(() => {
      worker.terminate()
      resolve({ success: false, errors: ['执行超时'] })
    }, timeout)

    worker.on('message', (result) => {
      clearTimeout(timer)
      resolve(result)
    })
    worker.on('error', reject)
  })
}
```

#### 🤖 AI 场景价值

AI 组件生成器是整个产品的核心价值所在：
1. **降低门槛**：不会 Vue/React 的用户也能通过自然语言描述生成组件
2. **提升效率**：熟练开发者可以用 AI 快速生成脚手架代码，聚焦业务逻辑
3. **最佳实践**：AI 生成的代码遵循项目规范（组合式 API、TypeScript、Tailwind）
4. **迭代优化**：用户可以通过反馈让 AI 逐步调整代码，直到满意

#### 📚 主线知识点原理解析

**Generator 5 节点编排**：

```
┌─────────────────────────────────────────────────────────────┐
│               Generator 5 节点状态机                         │
│                                                              │
│  ┌─────────┐                                                 │
│  │  clarify │ ← 用户需求不明确时追问（「请选择 UI 库」）       │
│  └────┬────┘                                                 │
│       │ 需求明确                                             │
│       ▼                                                      │
│  ┌─────────┐                                                 │
│  │ retrieve │ ← RAG 检索最相似的模板（Top-3）                 │
│  └────┬────┘                                                 │
│       │ 找到模板                                             │
│       ▼                                                      │
│  ┌─────────┐                                                 │
│  │ generate │ ← Prompt 组装 + LLM 生成代码                    │
│  └────┬────┘                                                 │
│       │ 生成完成                                             │
│       ▼                                                      │
│  ┌─────────┐                                                 │
│  │ preview  │ ← 沙箱执行 + 错误检测                          │
│  └────┬────┘                                                 │
│       │ 有错误？                                             │
│       ├── 是 → iterate → 重新 generate                      │
│       │                                    │                 │
│       └── 否 → ✅ completed                                 │
│                                                              │
│  迭代限制：最多 5 轮，超过则返回最佳结果 + 已知问题           │
└─────────────────────────────────────────────────────────────┘
```

#### 💻 代码实现

**1. Generator Service — `services/generator/agent.ts`**

```typescript
/**
 * 知识点 15.1-15.2：Generator Agent 编排
 * 
 * 学习要点：
 * - 5 节点状态机：clarify → retrieve → generate → preview → iterate
 * - 每个节点的输入/输出定义
 * - 状态持久化到 SQLite
 * - SSE 流式输出每个节点的进度
 */

export interface GeneratorState {
  jobId: string
  phase: GeneratorPhase
  userInput: string
  clarifiedInput?: string
  retrievedTemplates?: Template[]
  generatedCode?: string
  previewResult?: PreviewResult
  iterationCount: number
  maxIterations: number
  history: Array<{ phase: GeneratorPhase; timestamp: number }>
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed'
}

const MAX_ITERATIONS = 5

export async function* runGenerator(
  jobId: string,
  userInput: string,
  initialState?: Partial<GeneratorState>
): AsyncGenerator<GeneratorEvent> {
  const state: GeneratorState = {
    jobId,
    phase: 'clarify',
    userInput,
    iterationCount: 0,
    maxIterations: MAX_ITERATIONS,
    history: [],
    status: 'running',
    ...initialState,
  }

  yield { type: 'state_init', state: { ...state } }

  // ========== 节点 1: clarify ==========
  yield { type: 'phase_start', phase: 'clarify', message: '分析需求中...' }
  const clarification = await clarifyRequirements(userInput)

  if (clarification.questions.length > 0 && !state.clarifiedInput) {
    // 需求不明确，需要用户补充
    yield {
      type: 'clarify_needed',
      questions: clarification.questions,
    }
    state.status = 'paused'
    yield { type: 'state_update', state: { ...state } }
    return  // 等待用户补充后 resume
  }

  state.clarifiedInput = clarification.refinedInput || userInput
  state.phase = 'retrieve'
  state.history.push({ phase: 'clarify', timestamp: Date.now() })
  yield { type: 'phase_complete', phase: 'clarify' }

  // ========== 节点 2: retrieve ==========
  yield { type: 'phase_start', phase: 'retrieve', message: '检索模板中...' }
  const templates = await retrieveTemplates(state.clarifiedInput, 3)
  state.retrievedTemplates = templates
  state.phase = 'generate'
  state.history.push({ phase: 'retrieve', timestamp: Date.now() })

  yield {
    type: 'templates_found',
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      similarity: t.similarity,
      preview: t.code.slice(0, 100) + '...',
    })),
  }
  yield { type: 'phase_complete', phase: 'retrieve' }

  // ========== 节点 3: generate ==========
  state.phase = 'generate'
  state.history.push({ phase: 'generate', timestamp: Date.now() })

  while (state.status === 'running' && state.iterationCount < state.maxIterations) {
    state.iterationCount++

    yield {
      type: 'phase_start',
      phase: 'generate',
      message: `第 ${state.iterationCount} 次生成...`,
    }

    // 组装 Prompt
    const prompt = buildPrompt({
      userInput: state.clarifiedInput!,
      templates: state.retrievedTemplates,
      previousCode: state.generatedCode,
      previousErrors: state.previewResult?.errors,
      feedback: state.lastFeedback,
    })

    // LLM 流式生成
    let code = ''
    for await (const delta of chain.stream({ messages: [{ role: 'user', content: prompt }] })) {
      code += delta
      yield { type: 'code_stream', delta }
    }

    state.generatedCode = extractCode(code)  // 从 LLM 响应中提取代码块
    yield { type: 'code_complete', code: state.generatedCode }

    // ========== 节点 4: preview ==========
    state.phase = 'preview'
    yield { type: 'phase_start', phase: 'preview', message: '预览代码...' }

    const preview = await previewCode(state.generatedCode)
    state.previewResult = preview

    if (preview.errors.length === 0) {
      // 无错误，完成
      state.status = 'completed'
      state.phase = 'completed'
      yield {
        type: 'generation_complete',
        code: state.generatedCode,
        iterations: state.iterationCount,
      }
      break
    }

    // 有错误，进入 iterate
    yield {
      type: 'preview_errors',
      errors: preview.errors,
    }

    // ========== 节点 5: iterate ==========
    state.phase = 'iterate'
    yield {
      type: 'phase_start',
      phase: 'iterate',
      message: `迭代修复 (${state.iterationCount}/${state.maxIterations})...`,
    }

    // 将错误信息作为反馈注入下一轮
    state.lastFeedback = `上一次生成有以下错误需要修复:\n${preview.errors.join('\n')}`
    yield { type: 'phase_complete', phase: 'iterate' }
  }

  // 超过最大迭代次数
  if (state.status !== 'completed') {
    state.status = 'failed'
    yield {
      type: 'generation_failed',
      reason: '达到最大迭代次数',
      bestCode: state.generatedCode,
      knownIssues: state.previewResult?.errors || [],
    }
  }

  // 持久化最终状态
  await persistJob(state)
  yield { type: 'stream_end', jobId }
}
```

**2. Prompt 动态组装 — `services/generator/promptBuilder.ts`**

```typescript
/**
 * 知识点 15.3：Prompt 工程
 * 
 * 学习要点：
 * - 多段 Prompt 组装：system + 检索结果 + 用户需求 + 历史反馈
 * - 结构化输出：要求 LLM 只输出代码块
 * - Few-shot 示例：给 LLM 展示 1-2 个好的生成示例
 */

interface BuildPromptInput {
  userInput: string
  templates?: Template[]
  previousCode?: string
  previousErrors?: string[]
  feedback?: string
}

export function buildPrompt(input: BuildPromptInput): string {
  const parts: string[] = []

  // 1. System 指令（角色定义 + 输出约束）
  parts.push(`你是一个专业的 Vue 3 / React 组件生成器。

要求：
1. 生成可直接运行的单文件组件（SFC）
2. 使用 Composition API + TypeScript
3. 使用 Tailwind CSS 进行样式处理
4. 代码必须符合 ESLint 规范
5. 只输出代码，不要解释
6. 如果引用了 UI 库组件，确保 import 正确`)

  // 2. 检索到的模板（RAG 上下文）
  if (input.templates && input.templates.length > 0) {
    parts.push(`\n参考以下相似模板的实现方式：

${input.templates.map((t, i) => `--- 模板 ${i + 1}（相似度: ${t.similarity}）---
${t.code.slice(0, 500)}${t.code.length > 500 ? '...（已截断）' : ''}`).join('\n\n')}`)
  }

  // 3. 用户原始需求
  parts.push(`\n用户需求：
${input.userInput}`)

  // 4. 历史上下文（迭代时使用）
  if (input.previousCode && input.previousErrors) {
    parts.push(`\n上一次生成的代码有以下错误需要修复：
${input.previousErrors.map(e => `- ${e}`).join('\n')}

请修复上述错误，生成修正后的代码。`)
  }

  if (input.feedback) {
    parts.push(`\n用户反馈：
${input.feedback}`)
  }

  // 5. 输出格式约束
  parts.push(`\n输出格式：
\`\`\`vue
<template>...</template>
<script setup lang="ts">...</script>
<style scoped>...</style>
\`\`\``)

  return parts.join('\n')
}
```

**3. Generator 路由 — `routes/generator.ts`**

```typescript
/**
 * 知识点 15.4：Generator API
 * 
 * 学习要点：
 * - POST /api/generator/run → SSE 事件流
 * - GET /api/generator/jobs → 任务列表
 * - GET /api/generator/jobs/:id → 任务详情
 * - POST /api/generator/jobs/:id/resume → 恢复 clarify
 */

router.post('/run', asyncHandler(async (req, res) => {
  const { input } = req.body

  if (!input?.trim()) {
    throw new AppError('请输入组件描述', 400, 'VALIDATION_ERROR')
  }

  const jobId = crypto.randomUUID()

  // 创建任务记录
  db.prepare(
    'INSERT INTO generator_jobs (id, input, status, created_at) VALUES (?,?,?,?)'
  ).run(jobId, input, 'running', Date.now())

  // SSE 输出
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  for await (const event of runGenerator(jobId, input)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)

    // 中间状态持久化
    if (event.type === 'state_update') {
      db.prepare(
        'UPDATE generator_jobs SET state_json = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(event.state), Date.now(), jobId)
    }
  }

  res.end()
}))

// 恢复 clarify（用户补充信息后）
router.post('/jobs/:id/resume', asyncHandler(async (req, res) => {
  const { additionalInput } = req.body
  const jobId = req.params.id

  const job = db.prepare('SELECT * FROM generator_jobs WHERE id = ?').get(jobId)
  if (!job) throw new AppError('任务不存在', 404, 'NOT_FOUND')

  const state = JSON.parse(job.state_json || '{}')

  res.setHeader('Content-Type', 'text/event-stream')
  for await (const event of runGenerator(jobId, job.input, {
    ...state,
    clarifiedInput: additionalInput,
  })) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.end()
}))

// 任务列表
router.get('/jobs', asyncHandler(async (_req, res) => {
  const jobs = db.prepare(
    'SELECT * FROM generator_jobs ORDER BY created_at DESC LIMIT 20'
  ).all()
  res.json({ jobs })
}))

// 任务详情
router.get('/jobs/:id', asyncHandler(async (req, res) => {
  const job = db.prepare('SELECT * FROM generator_jobs WHERE id = ?').get(req.params.id)
  if (!job) throw new AppError('任务不存在', 404, 'NOT_FOUND')
  res.json({ job })
}))
```

**4. 前端 Generator 页面 — `pages/generator/index.vue`**

```vue
<!--
  知识点 15.5：Generator 前端
 -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSSE } from '~/composables/useSSE'

const prompt = ref('')
const phases = ref<PhaseEvent[]>([])
const currentCode = ref('')
const currentPhase = ref<string>('idle')
const isGenerating = ref(false)
const needsClarification = ref(false)
const clarificationQuestions = ref<string[]>([])

const { connect, isStreaming } = useSSE()

async function startGeneration() {
  if (!prompt.value.trim()) return

  isGenerating.value = true
  phases.value = []
  currentCode.value = ''
  needsClarification.value = false

  await connect({
    url: '/api/generator/run',
    method: 'POST',
    body: { input: prompt.value },
    onMessage: (event) => {
      const e = event as GeneratorEvent

      switch (e.type) {
        case 'phase_start':
          currentPhase.value = e.phase
          phases.value.push({ phase: e.phase, status: 'running', message: e.message })
          break
        case 'phase_complete':
          markPhaseComplete(e.phase)
          break
        case 'code_stream':
          currentCode.value += e.delta
          break
        case 'clarify_needed':
          needsClarification.value = true
          clarificationQuestions.value = e.questions
          isGenerating.value = false
          break
        case 'generation_complete':
          currentCode.value = e.code
          currentPhase.value = 'completed'
          markPhaseComplete('generate')
          markPhaseComplete('preview')
          break
        case 'generation_failed':
          currentPhase.value = 'failed'
          break
      }
    },
    onComplete: () => {
      isGenerating.value = false
    },
    onError: () => {
      isGenerating.value = false
      currentPhase.value = 'failed'
    },
  })
}

function markPhaseComplete(phase: string) {
  const p = phases.value.find(p => p.phase === phase)
  if (p) p.status = 'completed'
  else phases.value.push({ phase, status: 'completed', message: '' })
}

async function resumeWithClarification(answer: string) {
  needsClarification.value = false
  isGenerating.value = true
  await connect({
    url: `/api/generator/jobs/${currentJobId}/resume`,
    method: 'POST',
    body: { additionalInput: answer },
    onMessage: (event) => { /* 同上 */ },
  })
}
</script>

<template>
  <div class="generator-page h-screen flex flex-col">
    <!-- 左侧：需求输入 + 进度 -->
    <div class="w-80 p-4 border-r flex flex-col">
      <textarea
        v-model="prompt"
        placeholder="描述你想要的组件，如：商品卡片、数据表格、带分页的列表..."
        class="flex-1 p-3 border rounded-lg resize-none mb-4"
        :disabled="isGenerating"
      />
      <button
        @click="startGeneration"
        :disabled="!prompt.trim() || isGenerating"
        class="w-full py-3 bg-blue-500 text-white rounded-lg disabled:opacity-50"
      >
        {{ isGenerating ? '生成中...' : '✨ AI 生成组件' }}
      </button>

      <!-- 进度时间线 -->
      <div class="mt-6 space-y-2">
        <div
          v-for="phase in phases"
          :key="phase.phase"
          class="flex items-center gap-2 text-sm"
          :class="{ 'opacity-50': phase.status === 'pending' }"
        >
          <span :class="{ 'animate-pulse': phase.status === 'running' }">
            {{ phase.status === 'completed' ? '✅' : phase.status === 'running' ? '⏳' : '⬜' }}
          </span>
          <span>{{ phaseLabel(phase.phase) }}</span>
        </div>
      </div>

      <!-- 澄清对话框 -->
      <div v-if="needsClarification" class="mt-4 p-3 bg-yellow-50 rounded-lg">
        <div class="text-sm font-medium mb-2">🤔 需要补充信息：</div>
        <div v-for="q in clarificationQuestions" class="text-xs text-slate-600 mb-2">
          {{ q }}
        </div>
        <button
          @click="resumeWithClarification(prompt)"
          class="text-xs text-blue-500 underline"
        >
          输入补充信息
        </button>
      </div>
    </div>

    <!-- 右侧：代码预览 + 实时预览 -->
    <div class="flex-1 flex">
      <!-- 代码编辑器 -->
      <div class="flex-1 flex flex-col">
        <div class="flex items-center justify-between p-3 border-b">
          <span class="font-medium">Generated Code</span>
          <div class="flex gap-2">
            <button @click="copyCode" class="text-sm px-3 py-1 border rounded">复制</button>
            <button
              v-if="currentPhase === 'completed'"
              @click="downloadCode"
              class="text-sm px-3 py-1 bg-blue-500 text-white rounded"
            >
              下载 .vue
            </button>
          </div>
        </div>
        <pre class="flex-1 p-4 overflow-auto text-sm bg-slate-900 text-slate-100">
          <code>{{ currentCode || '// 生成的代码将在这里显示...' }}</code>
        </pre>
      </div>

      <!-- 实时预览 -->
      <div class="flex-1 border-l bg-white">
        <div class="p-3 border-b font-medium">Live Preview</div>
        <iframe
          v-if="currentCode"
          :srcdoc="renderCode(currentCode)"
          class="w-full h-full"
          sandbox="allow-scripts"
        />
        <div v-else class="flex items-center justify-center h-full text-slate-400">
          实时预览区域
        </div>
      </div>
    </div>
  </div>
</template>
```

#### 📱 C 端生产化改造

| 维度 | 改造方案 |
|------|----------|
| **代码编辑** | Monaco Editor 替代 `<pre>`，支持语法高亮、智能提示、格式化 |
| **预览沙箱** | iframe `sandbox="allow-scripts"` + CDN 引入 Vue/React，实现真实渲染 |
| **历史版本** | 每次生成保存快照，用户可以在时间线中对比不同版本 |
| **导出** | 支持 `.vue` / `.tsx` / `.jsx` 三种格式导出 + 复制到剪贴板 |
| **模板市场** | 生成成功后推送到模板库，其他用户可以搜索使用 |
| **性能优化** | SSE 中间状态用 `shallowRef`，代码 >10000 字符时用虚拟滚动 |
| **移动端** | 375px 以下隐藏代码面板，只显示预览，通过 tab 切换 |
| **重试策略** | 失败后显示「重试」按钮，用户可以修改需求后重新生成 |

#### 🤝 与 React 对照

| Generator 概念 | React 对应 | 说明 |
|---|---|---|
| `runGenerator()` async generator | `useReducer` + 异步 action | 都是状态机实现 |
| `buildPrompt()` 字符串拼接 | 相同 | Prompt 工程与框架无关 |
| `useSSE()` composable | `useSSE()` hook | 都是 SSE 消费逻辑 |
| `<iframe srcdoc>` 预览 | 相同 | 沙箱渲染 |
| Monaco Editor (Vue 绑定) | Monaco Editor (React 绑定) | 编辑器组件不同 |
| `PhaseEvent` discriminated union | 相同 | TypeScript 类型安全 |
| Pinia `generatorStore` | Zustand `generatorStore` | 状态管理不同 |

#### 🧠 AI + C 端专属面试题

**题 1（高级 · 设计）**：设计一个 AI 组件生成器，从用户输入到输出可运行代码，整个流程是怎样的？

> **答案要点**：
> 1. **Clarify 节点**：用户输入 → LLM 判断需求是否明确 → 不明确则追问（「请选择 UI 库」「需要哪些功能？」）
> 2. **Retrieve 节点**：需求明确后 → RAG 检索 Top-3 相似模板 → 注入 Prompt 作为 Few-shot 示例
> 3. **Generate 节点**：组装 Prompt（System + 模板 + 需求 + 历史反馈）→ LLM 流式生成代码
> 4. **Preview 节点**：沙箱执行生成的代码 → 检测语法错误/运行时错误
> 5. **Iterate 节点**：有错误则将错误信息作为反馈注入下一轮 Prompt，最多 5 轮
> 6. **Complete 节点**：无错误或达到最大轮次 → 返回最终代码 + 已知问题列表

**题 2（中级 · 原理）**：RAG 检索在组件生成器中起什么作用？为什么不让 LLM 直接生成？

> **答案要点**：
> 1. **质量保证**：RAG 找到的模板是经过人工审核的高质量代码，LLM 基于这些模板生成的代码更可靠
> 2. **风格一致**：参考模板保证生成的代码风格与项目已有代码一致（API 用法、命名规范、样式方案）
> 3. **减少幻觉**：LLM 可能编造不存在的 API，参考真实模板后这种情况大幅减少
> 4. **可追溯**：用户可以看到 AI 参考了哪些模板，增加信任感
> 5. **速度更快**：有模板参考时，LLM 生成速度更快（上下文更清晰）
> 6. **对比**：不用 RAG → LLM 只能靠训练数据中的通用知识，容易生成不符合项目规范的代码

**题 3（高级 · UX 设计）**：组件生成器的迭代优化机制如何设计？用户如何参与迭代？

> **答案要点**：
> 1. **自动迭代**：生成 → 检测错误 → 修复 → 重新生成（最多 5 轮，用户无感知）
> 2. **用户反馈迭代**：用户看到结果后可以：
>    - 点击「不满意」→ 输入具体反馈（「按钮要居中」「改用紫色主题」）
>    - 在代码编辑器中直接修改 → 点击「基于修改重新生成」
>    - 选择历史版本中的某一版 → 点击「从这里继续迭代」
> 3. **反馈注入**：用户反馈作为 `feedback` 参数注入 Prompt，LLM 根据反馈调整代码
> 4. **版本对比**：展示当前版本 vs 上一版本的 diff，用户能清楚看到改了什么
> 5. **智能建议**：系统自动分析代码，给出优化建议（「建议添加 loading 状态」「缺少错误处理」）

**题 4（高级 · 安全）**：生成的代码在沙箱中执行，如何保证安全？

> **答案要点**：
> 1. **iframe sandbox**：HTML 预览用 `<iframe sandbox="allow-scripts">`，禁止 `allow-same-origin`、`allow-popups` 等权限
> 2. **Worker Threads**：Node.js 端用 Worker Threads 执行测试代码，与主线程隔离
> 3. **资源限制**：CPU 时间 5s、内存 128MB、执行超时自动终止
> 4. **无网络**：沙箱内禁止网络请求，防止数据外泄
> 5. **白名单 API**：只允许使用 Vue/React 核心 API，禁止 `eval`、`Function`、`fetch` 等
> 6. **代码扫描**：执行前扫描代码中的危险模式（`eval(`、`document.cookie`、`localStorage`），有则拒绝执行

---

## 实践任务

### 任务 1：Generator BFF 服务

- [ ] 创建 `services/generator/agent.ts`（5 节点状态机 + streamEvents）
- [ ] 创建 `services/generator/promptBuilder.ts`（多段 Prompt 动态组装）
- [ ] 创建 `services/generator/sandbox.ts`（Worker Threads 沙箱执行）
- [ ] 创建 `routes/generator.ts`（run/jobs/list/jobs/:id/resume 路由）
- [ ] 验证：`POST /api/generator/run` 返回 SSE 事件流

### 任务 2：Generator 前端

- [ ] 创建 `pages/generator/index.vue`（左侧输入+进度，右侧代码+预览）
- [ ] 实现 SSE 事件 → 进度时间线映射
- [ ] 实现澄清对话框（clarify → 用户补充 → resume）
- [ ] 实现代码复制/下载功能
- [ ] 实现 iframe 沙箱预览

### 任务 3：迭代优化

- [ ] 实现错误自动修复闭环（preview 检测 → iterate 修复 → 最多 5 轮）
- [ ] 实现用户反馈迭代（不满意 → 输入反馈 → 重新生成）
- [ ] 实现历史版本 diff 对比
- [ ] 实现任务持久化（刷新后恢复生成进度）

---

## 检验标准

- [ ] Generator 5 节点状态机正确：clarify → retrieve → generate → preview → iterate
- [ ] SSE 事件流正确：每个节点都有 phase_start/phase_complete 事件
- [ ] 代码能正常生成并通过沙箱执行
- [ ] 错误能自动迭代修复（最多 5 轮）
- [ ] 需求不明确时能追问用户（clarify 机制）
- [ ] 历史任务持久化：刷新后可恢复
- [ ] 代码预览用 iframe sandbox 隔离
- [ ] 支持用户反馈迭代（手动优化）
- [ ] 生产级改造至少覆盖 3 项（代码编辑器/版本对比/沙箱安全）
