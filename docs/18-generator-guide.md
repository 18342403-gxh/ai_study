# 18 · Generator 技术拆解 — 从对话到代码生成

> 模块：apps/generator（前端）+ services/generator（BFF）
> 前置知识：Vue 3 基础、Nuxt 3 SSR、LangGraph StateGraph、SSE 流式通信
> 难度：⭐⭐⭐ 中高级

---

## 一、整体架构

Generator 是这个项目的**产品主线**——把之前独立开发的 7 个 AI 能力模块（chain / rag / tools / agent）**编排成**一个可用的产品：用户说一句话，AI 输出代码文件。

```
┌──────────────────────────────────────────────────────────┐
│                    用户（浏览器）                           │
│                    http://localhost:3003                  │
└─────────────────────┬────────────────────────────────────┘
                      │  POST /api/generator/run
                      ▼
┌──────────────────────────────────────────────────────────┐
│  BFF Express (:3001)                                      │
│  routes/generator.ts    ← Zod schema 校验                 │
│  services/generator/agent.ts ← 5 节点 StateGraph 编排      │
│  services/generator/codegen.ts ← Prompt 模板 + LLM 调用   │
└─────────────────────┬────────────────────────────────────┘
                      │  SSE Event Stream
                      ▼
┌──────────────────────────────────────────────────────────┐
│  前端 Nuxt 3 (:3003)                                      │
│  pages/index.vue        ← 对话式 UI + SSE 解析            │
│  layouts/default.vue   ← 侧边栏导航                       │
└──────────────────────────────────────────────────────────┘
```

### 两种产物模式

| 模式 | artifactType | 产物 | 文件数 |
|------|-------------|------|--------|
| 组件 | `component` | Vue SFC 或 React TSX | 1 个 |
| Skill | `skill` | SKILL.md + 可选 scripts/*.ts | 1~3 个 |

用 **Discriminated Union**（`ComponentRequest \| SkillRequest`）在类型层严格区分，`framework` 只在组件模式需要，`skillName` 只在 Skill 模式需要。

---

## 二、核心技术点

### 技术点 1：LangGraph 5 节点编排

Agent 是整个 Generator 的"大脑"，用 LangGraph 的 `StateGraph` 把 5 个步骤串起来：

```
clarify → retrieve → generate → preview → iterate
  │          │          │          │          │
  │          │          │          │          └─ 没反馈 → 结束
  │          │          │          │
  │          │          │          └─ 检查产出，返回质量评分
  │          │          │
  │          │          └─ 调 LLM 生成代码文件
  │          │
  │          └─ RAG 检索相关参考（可选）
  │
  └─ 调 LLM 把自然语言需求细化成结构化描述
```

**关键代码**（agent.ts 简化）：

```typescript
const graph = new StateGraph<GeneratorState>({
  channels: { state: { reducer: (cur, upd) => ({ ...cur, ...upd }) } },
})
  .addNode('clarify', clarifyNode)
  .addNode('retrieve', retrieveNode)
  .addNode('generate', generateNode)
  .addNode('preview', previewNode)
  .addNode('iterate', iterateNode)
  .addEdge(START, 'clarify')
  .addConditionalEdges('clarify', shouldContinue)
  .addConditionalEdges('generate', shouldIterate)
  .addEdge('preview', END)
```

**为什么用 StateGraph 而不是简单 async/await？**

| 方面 | async/await | StateGraph |
|------|------------|------------|
| 可中断 | ❌ 一旦启动没法 pause | ✅ 每个节点边界天然可中断 |
| 可观测 | ❌ 只能靠日志 | ✅ 每个节点有 start/end 事件，前端实时展示 |
| 可迭代 | ❌ 要自己写重试逻辑 | ✅ `iterate` 节点天然支持反馈循环 |
| 可恢复 | ❌ 进程挂了就丢了 | ✅ 可以接 Checkpointer 持久化状态 |

### 技术点 2：Prompt 模板路由（双模式复用）

`codegen.ts` 的核心设计是**一套流程，两套 prompt**：

```typescript
// Discriminated Union 类型守卫
function isComponentRequest(req: CodegenRequest): req is ComponentRequest {
  return req.type === 'component'
}

export function buildSystemPrompt(req: CodegenRequest): string {
  if (isComponentRequest(req)) {
    return ComponentPromptBuilder.build(req)  // Vue/React 组件规范
  }
  return SkillPromptBuilder.build(req)         // Trae SKILL.md frontmatter 规范
}
```

组件 prompt 要求输出：
```
```vue
<template>...</template>
<script setup lang="ts">...</script>
<style scoped>...</style>
```
```

Skill prompt 要求输出（多文件）：
```
=== FILE: SKILL.md ===
---
name: "xxx"
description: "xxx"
---
...
=== FILE: scripts/main.ts ===
...
```

**多文件解析**（`parseMultiFileOutput`）是关键——用 `=== FILE: <path> ===` 作为分隔符，把 LLM 的一段输出拆成多个文件。

### 技术点 3：SSE 流式通信

前端不直接等 BFF 返回完整结果，而是用 **Server-Sent Events** 实时接收进度：

```typescript
// 前端：runGenerator() 核心循环
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''  // 没读完的最后一行留着下次拼

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const event = JSON.parse(line.slice(6))
    handleEvent(event)  // on_chain_start / on_chain_end / on_error
  }
}
```

**SSE 协议要点**：
- 每条消息 `data: <json>\n\n`（注意双换行）
- `ReadableStream` 的 `reader.read()` 可能在任意位置切断一条 JSON，所以需要 `buffer` + 按 `\n` 分割 + `pop()` 回收未完成的最后一行
- 项目踩过的坑：buffer 没留尾巴导致 JSON 被截断 → parse 失败 → **SSE 整条断掉**

### 技术点 4：对话式 UI + 状态持久化

前端不是传统的"表单 + 结果"，而是**对话历史 + 可迭代修改**：

```
用户: "帮我生成一个商品卡片"
AI:   [进度: 细化 ✅ 检索 ✅ 生成 ✅ 预览 ✅]
       [代码卡片]
用户: "按钮要居中，加 loading 状态"
AI:   [重新走 clarify→generate]
       [更新后的代码卡片]
```

**关键状态**：
- `chatHistory[]`：累积的对话记录（每条可以带 files 和 phases）
- `stateId`：BFF 返回的生成状态 ID，迭代时传回 `/iterate`
- `currentFiles`：当前最新版本的文件列表

**UI 组件层级**：
```
NuxtLayout (侧边栏 + 主区域)
  └─ index.vue
       ├─ 上方对话区 (bg-slate-50)
       │    ├─ 用户气泡 (蓝渐变)
       │    ├─ AI 气泡 (浅灰边 + 进度时间线 + 文件卡片)
       │    └─ "AI 正在思考" 跳动动画
       └─ 下方输入区 (bg-white)
            ├─ 框架/Skill 参数栏
            ├─ 迭代修改输入 (生成后自动出现)
            └─ 主 textarea + 生成按钮
```

### 技术点 5：Discriminated Union + Zod refine 交叉校验

后端 Zod schema 不只是校验字段存在，还要**交叉校验互斥字段**：

```typescript
const generatorInputSchema = z.object({
  artifactType: z.enum(['component', 'skill']),
  requirement: z.string().min(1),
  framework: z.enum(['vue', 'react']).optional(),
  skillName: z.string().min(1).optional(),
  scriptLang: z.enum(['ts', 'py']).optional(),
}).refine(
  (data) => {
    if (data.artifactType === 'component') return !!data.framework
    if (data.artifactType === 'skill') return !!data.skillName
    return true
  },
  { message: 'component 需要 framework，skill 需要 skillName' }
)
```

**前端也用同样的 Union 模式**：
```typescript
type ArtifactType = 'component' | 'skill'

const buildPayload = () => {
  if (activeTab.value === 'component') {
    return { type: 'component', framework: framework.value, requirement }
  }
  return { type: 'skill', skillName: skillName.value, scriptLang, requirement }
}
```

这样前后端类型对齐，TypeScript 编译期就能发现字段遗漏。

---

## 三、踩坑记录

| 坑 | 现象 | 原因 | 解决 |
|----|------|------|------|
| SSE buffer 截断 | JSON parse 失败，整条流断掉 | `reader.read()` 可能在 JSON 中间切断，直接 `split('\n')` 把半截 JSON 当完整的去 parse | 用 `buffer.split('\n')` 后 `pop()` 回收最后一行留着下次拼 |
| NuxtLayout 重复渲染 | 侧边栏显示两次 | `app.vue` 已有 `<NuxtLayout>`，page 里又套一层 | page 删掉 layout 包装，layout 用 provide/inject 暴露状态 |
| Tailwind 深色不可读 | 深色模式下白色文字看不清 | 深色区用了 `surface-900` 但头像/气泡也用深色 | 显示区改浅色（`bg-slate-50`），仅代码块保持深色 |
| Discriminated Union 字段缺失 | `language` 字段可选性不一致 | `ChatHistory` 里 `files` 没有 `language` 字段但代码引用了 | 定义统一的 `FileItem` type，`language` 标记为 optional |
| RAG 没数据时 LLM 瞎编 | 生成的组件不符合项目规范 | RAG 检索为空但 prompt 没提示 | 在 `retrieve` 节点加空结果 fallback，prompt 里说"如果没参考就用最佳实践" |

---

## 四、文件清单速查

### 后端

| 文件 | 行数 | 职责 |
|------|------|------|
| `services/generator/agent.ts` | ~350 | StateGraph 5 节点编排 + Zod schema + SSE 流 |
| `services/generator/codegen.ts` | ~200 | Prompt 模板 + 多文件解析 + 双模式类型 |
| `routes/generator.ts` | ~80 | HTTP 路由 + Zod 校验 + 调用 agent |
| `services/rag/index.ts` | — | 向量检索（被 retrieve 节点调用） |
| `services/chain/chatChain.ts` | — | LLM 调用链（被各节点调用） |

### 前端

| 文件 | 行数 | 职责 |
|------|------|------|
| `apps/generator/pages/index.vue` | ~550 | 对话式 UI + SSE 解析 + 迭代修改 |
| `apps/generator/layouts/default.vue` | ~88 | 侧边栏导航 + provide activeTab |
| `apps/generator/assets/css/main.css` | ~90 | 滚动条 / 气泡 / 动画 |
| `apps/generator/tailwind.config.ts` | ~48 | 蓝色主题 + surface 深色 + sidebar 配色 |

### 共享

| 文件 | 职责 |
|------|------|
| `packages/shared/` | 类型定义（被前后端复用） |

---

## 五、扩展阅读

- [LangGraph StateGraph 官方文档](https://langchain-ai.github.io/langgraph/) — 为什么 StateGraph 比链式调用好
- [SSE 协议规范](https://html.spec.whatwg.org/multipage/server-sent-events.html) — `data:` 前缀、双换行、reconnect
- [Zod refine 交叉校验](https://zod.dev/?id=refine) — 条件必填字段的正确写法
- [Trae IDE Skill 格式](https://docs.trae.cn/) — 我们的 Skill 模式产物就是这个格式
- [项目记忆](./.trae-configs/) — 里面记录了 SSE 4 个 bug 的详细排查过程

---

## 六、练习：你可以试试

1. **改 prompt**：把 Skill 模式的 prompt 改成要求输出 TypeScript 脚本，重新跑一次看差异
2. **加节点**：在 StateGraph 里加一个 `format` 节点，用 Prettier 格式化产出的代码
3. **前端新功能**：在对话区加代码 diff 视图，展示迭代前后的变化
4. **换产物类型**：加一个新的 `artifactType: 'docs'`，让 Generator 能生成 Markdown 文档

---

> 💡 这是 frontend-workflow **Phase ④ 讲解**的产出。技术拆解 + 踩坑记录 + 扩展阅读，学习者应该能看懂 Generator 是怎么从对话一路走到代码文件的。
