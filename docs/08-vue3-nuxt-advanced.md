# Vue3 / Nuxt3 中高级知识点

> **面向读者**：有 Vue3 基础，希望深入理解 AI 组件生成器项目中实际用到的 Vue3/Nuxt3 中高级特性的前端工程师。
>
> **文档结构**：每个知识点严格遵循 7 段式（💡基础补充 → 🤖AI 场景价值 → 📚原理 → 💻代码 → 📱生产化 → 🤝React 对照 → 🧠面试题）。

---

## 一、Composition API 工程化

### 1.1 Composables 抽取规范（useXxx 命名）

#### 💡 JS/浏览器/Node 基础补充

- **模块级单例**：ES Module 只执行一次，模块顶层的变量在所有导入方之间共享，这是 Composable 实现跨组件状态共享的基础。
- **闭包与词法作用域**：`useChat()` 返回的函数捕获了模块级 ref 的引用，即使组件销毁再重建，状态也不丢失。
- **可选链 (?.) 与空值合并 (??)**：处理对话消息中 `undefined/null` 字段的安全访问。

#### 🤖 AI 场景价值

AI 组件生成器的核心是 **多会话管理 + SSE 流式对话**。`useChat()` composable 封装了会话 CRUD、消息流式追加、localStorage 持久化等全部逻辑，被 `index.vue`、`history.vue`、`library.vue`、`settings.vue` 四个页面共同使用。如果用 Pinia 管理，需要创建 store + actions + getters，对于中等复杂度逻辑来说，Composable 更轻量、更灵活。

#### 📚 主线知识点原理解析

**Composables 抽取原则**：

| 原则 | 说明 | 示例 |
|------|------|------|
| `useXxx` 命名规范 | 以 `use` 前缀标识，表明是组合式函数 | `useChat()`、`useRuntimeConfig()` |
| 单一职责 | 一个 composable 只管一件事 | `useChat` 只管对话，不管 UI 状态 |
| 入参可配置 | 通过参数接收定制化选项 | `useChat()` 无参数但通过闭包暴露 API |
| 返回对象 | 返回响应式状态 + 操作方法 | `return { sessions, sendMessage, ... }` |

**模块级单例 vs Pinia Store**：

```
┌─────────────────────────────────────────────────────┐
│  模块级 Composable (本项目方案)                        │
│  ┌─────────────────────────────────────────────┐    │
│  │  composables/useChat.ts                     │    │
│  │  const sessions = ref([])  ← 模块级变量     │    │
│  │  export function useChat() { ... }          │    │
│  └─────────────────────────────────────────────┘    │
│  ✅ 零依赖，不需要 Pinia                               │
│  ✅ 类型推导更自然                                    │
│  ❌ 不支持 DevTools 时间旅行                          │
│  ❌ 不支持 SSR hydration 自动恢复                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Pinia Store                                        │
│  ┌─────────────────────────────────────────────┐    │
│  │  stores/chat.ts                             │    │
│  │  export const useChatStore = defineStore()  │    │
│  └─────────────────────────────────────────────┘    │
│  ✅ DevTools 支持                                     │
│  ✅ SSR hydration 自动恢复                           │
│  ❌ 需要安装 pinia 模块                               │
│  ❌ 对于简单逻辑过于重量级                             │
└─────────────────────────────────────────────────────┘
```

#### 💻 代码实现（项目真实代码）

**文件：`composables/useChat.ts`**

```typescript
import { ref, computed } from 'vue'

// ① 类型定义：给 composable 建立类型契约
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  code?: string
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// ② 模块级单例状态：所有组件共享同一份数据
const sessions = ref<ChatSession[]>([])
const activeSessionId = ref<string>('')
const isLoading = ref(false)
const streamingContent = ref('')
const initialized = ref(false)

// ③ Composable 函数：暴露状态 + 操作方法
export function useChat() {
  // computed 派生状态
  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) || null
  )

  const currentMessages = computed<ChatMessage[]>(
    () => activeSession.value?.messages ?? []
  )

  // ④ 操作方法：增删改查 + SSE 流式处理
  const sendMessage = async (content: string) => {
    // ... SSE 流式解析（见第五章）
  }

  // ⑤ 返回所有需要在组件中使用的状态和方法
  return {
    sessions,
    activeSessionId,
    activeSession,
    currentMessages,
    isLoading,
    streamingContent,
    sendMessage,
    createNewSession,
    switchSession,
    deleteSession,
    clearCurrentSession,
    loadOrCreateSession,
  }
}
```

**组件中使用（`pages/index.vue`）**：

```typescript
const chat = useChat()
const {
  currentMessages,
  activeSessionTitle,
  isLoading,
  sendMessage,
  createNewSession,
  clearCurrentSession,
  loadOrCreateSession,
} = chat
```

#### 📱 C 端生产化改造

| 阶段 | 改造项 | 说明 |
|------|--------|------|
| 当前 | localStorage 持久化 | 容量 ~5MB，适合小型会话 |
| 生产 | IndexedDB 存储 | 使用 `idb` 库封装，支持大量会话 + 索引查询 |
| 生产 | Token 限流滑动窗口 | 超过 12 轮对话自动裁剪早期消息，避免 Token 超限 |
| 生产 | AbortController 支持 | 用户点击「停止生成」时中断 SSE 连接 |
| 生产 | 指数退避重试 | 网络断开后 1s → 2s → 4s → 8s 重试，最多 5 次 |

#### 🤝 与 React 对照

| Vue 3 Composition API | React Hooks | 说明 |
|----------------------|-------------|------|
| `useChat()` composable | `useChat()` custom hook | 命名一致，思想一致 |
| 模块级 `ref` 单例 | 模块级 `useRef` / `useState` | React 中需配合 Context 或 external store |
| `computed()` 派生状态 | `useMemo()` | Vue 自动追踪依赖，React 需手动指定 deps |
| `watchEffect()` 副作用 | `useEffect()` | Vue 自动收集依赖，React 需手动指定 deps |
| `provide/inject` 跨层级传值 | Context Provider/Consumer | Vue 支持多 provider 同名覆盖 |

#### 🧠 面试题/常见坑

**Q1（AI 场景）：你的 AI 对话 composable 为什么不用 Pinia 而用模块级单例？**

> A：核心原因有三：① **零依赖**：不需要安装 Pinia 模块即可工作，降低项目复杂度；② **粒度更细**：Composable 可以按需引入，Pinia store 是全局单例，对于只在少数页面使用的逻辑（如对话功能），Composable 更合适；③ **SSR 安全**：模块级变量在 SSR 期间不会被意外重置（如果用 `pinia` 的 `$reset()` 可能误操作）。缺点是没有 DevTools 时间旅行，但对于 AI 对话场景，开发者更关心的是实时流式输出的正确性而非时间旅行。

**Q2：如何避免 composable 中的模块级状态在 SSR 时被多个请求共享？**

> A：在 Nuxt SSR 模式下，模块级 `ref` 确实是全局单例，Node 服务端多请求会共享状态。解决方案：在 composable 初始化时使用 `useState()`（Nuxt 3 内置）或在 `setup` 中重新赋值。本项目通过 `initialized` ref + `loadOrCreateSession()` 做了懒加载保护，但严格来说 SSR 场景应使用 `useState` 或 Pinia store + `pick` 选项。

**Q3（AI 场景）：SSE 流式输出中，为什么用模块级 `streamingContent` 而不是组件内 `ref`？**

> A：AI 对话的流式状态需要跨组件共享。当用户从 `index.vue` 切换到 `settings.vue` 再切回时，流式状态不应丢失。模块级 ref 确保状态独立于组件生命周期存在。同时，`streamingContent` 被 `ChatBubble` 的 `isStreaming` prop 和 `TeachingPanel` 的进度条同时消费，是典型的跨组件共享状态。

---

## 二、Vue3 响应式进阶

### 2.1 ref vs reactive 使用边界

#### 💡 JS/浏览器/Node 基础补充

- **Proxy vs Object.defineProperty**：Vue3 使用 Proxy 代理整个对象，无需遍历属性，支持数组索引、新增属性、`delete` 操作等；Vue2 的 `Object.defineProperty` 只能劫持已有属性。
- **JavaScript 栈 vs 堆**：`ref()` 内部对 `.value` 的访问/赋值在栈上完成，`reactive()` 对 Proxy 的操作在堆上完成。理解这一点有助于选择合适的响应式方案。
- **Proxy 陷阱（Trap）**：`get`/`set`/`deleteProperty`/`ownKeys` 等拦截器是 Vue3 响应式系统的底层机制。

#### 🤖 AI 场景价值

AI 组件生成器涉及大量大对象（会话列表、消息数组、生成的代码字符串）。错误地使用 `reactive()` 包裹大对象会导致不必要的深层代理开销。`useChat.ts` 中精确选择了 `ref()` 管理会话列表（数组引用会整体替换），`computed()` 派生当前会话（惰性计算），避免了过度响应式。

#### 📚 主线知识点原理解析

**ref vs reactive 选择决策树**：

```
需要响应式的数据是什么？
│
├─ 基本类型（string/number/boolean）
│  └─ ✅ 必须用 ref()，基本类型无法被 Proxy 代理
│
├─ 对象/数组，需要整体替换
│  └─ ✅ 用 ref()，如 sessions = ref([])
│     sessions.value = newList  ← 整体替换触发更新
│
├─ 对象/数组，只修改内部属性
│  └─ ✅ 用 reactive()，如 const form = reactive({ name: '' })
│     form.name = 'new'  ← 属性修改触发更新
│
├─ 需要在模板中解构使用
│  └─ ✅ 用 reactive()，模板自动 unwrap
│     或用 toRefs() 解构 ref 对象
│
└─ 大对象/嵌套深，性能敏感
   └─ ✅ 用 shallowRef() / shallowReactive()
      只代理顶层，内部对象不响应
```

**核心规则**：
1. **数组/对象整体替换 → `ref()`**：`sessions.value = newList`（整体替换引用）
2. **对象内部属性修改 → `reactive()`**：`form.name = 'xxx'`（属性级修改）
3. **基本类型 → 只能 `ref()`**：`isLoading.value = true`
4. **大对象/第三方实例 → `shallowRef()`**：Monaco Editor 实例、Chart 实例

#### 💻 代码实现（项目真实代码）

**正确示例（`composables/useChat.ts`）**：

```typescript
// ✅ ref：数组会被整体替换（sessions.value = loadSessions()）
const sessions = ref<ChatSession[]>([])
const activeSessionId = ref<string>('')
const isLoading = ref(false)
const streamingContent = ref('')

// ✅ computed：惰性派生，仅在依赖变化时计算
const activeSession = computed(() =>
  sessions.value.find((s) => s.id === activeSessionId.value) || null
)
const currentMessages = computed<ChatMessage[]>(
  () => activeSession.value?.messages ?? []
)
```

**错误示例**：

```typescript
// ❌ 错误：用 reactive 包裹数组然后整体替换
const state = reactive({ sessions: [] as ChatSession[] })
state.sessions = loadSessions()  // reactive 数组整体替换可以工作
// 但 state.sessions.filter(...) 会创建新数组，触发更新
// 且 reactive 对象的每个属性都会被递归代理，性能差

// ❌ 错误：ref 套 ref
const nested = ref(ref([]))  // 无意义，内层 ref 会被自动 unwrap
```

#### 📱 C 端生产化改造

| 场景 | 当前方案 | 生产改造 |
|------|---------|---------|
| 会话列表（~100 条） | `ref([])` 正常 | `shallowRef()` + `triggerRef()` 手动触发，避免深层代理 |
| 消息内容（SSE 流式追加） | `ref('')` 字符串替换 | `shallowRef()` 存储 + 节流更新（每 50ms 批量更新一次 DOM） |
| Monaco Editor 实例 | 暂未实现 | `shallowRef()` 存储，Monaco 内部自行管理渲染 |
| 配置对象 | `reactive()` | `shallowReactive()` 只代理顶层配置项 |

**SSE 流式节流示例**：

```typescript
// composables/useChat.ts 中的 sendMessage
let updateTimer: ReturnType<typeof setTimeout> | null = null

const throttleUpdate = (content: string, code?: string) => {
  if (updateTimer) return  // 节流中，跳过
  updateTimer = setTimeout(() => {
    updateLastAssistant(content, code)
    updateTimer = null
  }, 50)
}

// SSE 循环中
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  // ...解析 chunk...
  fullContent += delta
  streamingContent.value = fullContent
  throttleUpdate(fullContent, extractedCode)  // 节流 DOM 更新
}
```

#### 🤝 与 React 对照

| Vue 3 | React | 关键差异 |
|-------|-------|---------|
| `ref(0)` → `.value` | `useState(0)` → `[state, setState]` | Vue 自动解包，React 用 setter |
| `reactive({a:1})` → `a=2` | `useState({a:1})` → `setState({a:2})` | Vue 直接修改，React 必须新建引用 |
| `computed(()=>...)` | `useMemo(()=>...)` | Vue 自动依赖追踪，React 需手动 deps |
| `shallowRef()` | `useRef()` | Vue 有自动 shallow 响应式，React useRef 不触发渲染 |
| `toRefs(obj)` | — | Vue 专有，将 reactive 对象的每个属性转为独立 ref |

#### 🧠 面试题/常见坑

**Q1（AI 场景）：SSE 流式输出时，为什么用 `streamingContent.value = fullContent` 而不是直接操作 DOM？**

> A：Vue3 响应式的核心优势是 **声明式 UI = f(状态)**。当 `streamingContent` 变化时，Vue 的渲染器自动更新 DOM。如果手动操作 DOM（如 `document.querySelector('.content').textContent = xxx`），会绕过 Vue 的虚拟 DOM diff 机制，导致：① 模板中的指令（如 `v-if`、`v-for`）失效；② 与其他响应式状态不一致；③ 无法被 DevTools 追踪。但在生产环境中，为了性能可以用 `shallowRef + triggerRef` 做手动触发，本质上还是利用了响应式系统。

**Q2：`toRefs` 解构后响应式丢失的问题？**

```typescript
// ❌ 错误：reactive 对象直接解构
const state = reactive({ count: 0, name: 'hello' })
const { count, name } = state  // count 和 name 失去响应式！
count = 10  // 不会触发 UI 更新

// ✅ 正确：用 toRefs 解构
const { count, name } = toRefs(state)
count.value = 10  // 触发 UI 更新
```

**Q3：`reactive` 的解构丢失响应式，`ref` 解构却不会丢？为什么？**

> 因为 `reactive` 返回的是 Proxy 代理对象，解构时取的是原始值的副本。而 `ref` 返回的是包含 `value` 属性的普通对象，解构后 `value` 属性的引用关系保持。所以 `const chat = useChat(); const { sessions } = chat` 中，`sessions` 保持响应式——因为 `useChat()` 返回的是 `{ sessions: ref(...) }`，解构出来的是同一个 ref 对象的引用。

---

## 三、Vue3 + TypeScript 实战

### 3.1 ref<泛型>、computed<返回类型>

#### 💡 JS/浏览器/Node 基础补充

- **TypeScript 泛型**：`<T>` 参数化类型，让同一套逻辑适配不同类型。`ref<T>` 内部定义为 `Ref<T>`。
- **类型推导 vs 显式标注**：TypeScript 能从初始值推导类型，但在复杂场景（如泛型接口）需要显式标注。
- **Nominal Type System（名义类型系统）**：TypeScript 使用结构化类型（structural），只要结构相同就是兼容的，这对 Vue 的 `defineProps<Interface>()` 非常友好。

#### 🤖 AI 场景价值

AI 组件生成器涉及多种数据类型：`ChatMessage`（联合类型 role）、`ChatSession`（嵌套 messages）、`Template`（带 prompt 模板）。如果没有 TypeScript 类型保护，很容易在 SSE 解析、会话切换、消息追加等场景出现 `undefined` 访问错误。泛型让 `ref`/`computed` 的类型精确到字段级别。

#### 📚 主线知识点原理解析

**Vue3 + TS 核心类型系统**：

```
┌──────────────────────────────────────────────────────┐
│  ref<T>         → Ref<T>                             │
│  computed<T>    → ComputedRef<T>                     │
│  reactive<T>    → UnwrapNestedRefs<T>                │
│  readonly<T>    → DeepReadonly<UnwrapNestedRefs<T>>  │
│  shallowRef<T>  → ShallowRef<T>                      │
└──────────────────────────────────────────────────────┘

泛型推导示例：
ref<ChatSession[]>([])   → Ref<ChatSession[]>
                           .value → ChatSession[]
                           .value[0] → ChatSession
                           .value[0].messages → ChatMessage[]
                           .value[0].messages[0].role → 'user' | 'assistant' | 'system'
```

**组件 Props 类型安全演进**：

```typescript
// Vue 2 风格：运行时校验，无类型安全
export default {
  props: {
    content: { type: String, required: true },
    role: { type: String, required: true },
    timestamp: Number,
    isStreaming: Boolean,
  }
}

// Vue 3.3+ 泛型语法：编译时类型安全，零运行时开销
defineProps<{
  content: string
  role: 'user' | 'assistant' | 'system'
  timestamp?: number
  isStreaming?: boolean
}>()
```

#### 💻 代码实现（项目真实代码）

**`composables/useChat.ts` - 泛型 ref 和 computed**：

```typescript
// ① 接口定义：给数据建模
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  code?: string  // 可选属性
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// ② ref<泛型>：精确约束类型
const sessions = ref<ChatSession[]>([])
// sessions.value 类型为 ChatSession[]
// sessions.value.find(...) 返回 ChatSession | undefined（可空联合）
// TypeScript 会强制你处理 undefined

const activeSessionId = ref<string>('')
const isLoading = ref(false)
// isLoading.value 类型为 boolean（从初始值推导）

// ③ computed<返回类型>：显式标注返回类型
const activeSession = computed(() =>
  sessions.value.find((s) => s.id === activeSessionId.value) || null
)
// activeSession.value 类型为 ChatSession | null

// ④ 带泛型的 computed 解构
const currentMessages = computed<ChatMessage[]>(
  () => activeSession.value?.messages ?? []
)
// currentMessages.value 类型为 ChatMessage[]（非空！?? [] 兜底）
```

**`components/ChatBubble.vue` - defineProps 泛型**：

```typescript
// ⑤ defineProps<接口>：类型安全的 Props
defineProps<{
  content: string
  role: 'user' | 'assistant' | 'system'
  timestamp?: number
  isStreaming?: boolean
}>()
// props.content 类型为 string
// props.role 类型为 'user' | 'assistant' | 'system'
// props.timestamp 类型为 number | undefined

const formatTime = (ts?: number) => {
  if (!ts) return ''
  // ... 类型守卫后 ts 自动收窄为 number
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
```

**`components/ChatInput.vue` - defineEmits 泛型**：

```typescript
// ⑥ defineEmits 类型化事件
const emit = defineEmits<{
  send: [content: string]  // 事件名: [参数类型]
}>()

// 使用时 TypeScript 检查参数类型
const handleSend = () => {
  emit('send', text.value.trim())  // ✅ string 类型
  // emit('send', 123)  ❌ TypeScript 编译错误
}
```

#### 📱 C 端生产化改造

| 改造项 | 说明 |
|--------|------|
| `strict: true` | `nuxt.config.ts` 中启用严格模式，编译时拦截类型错误 |
| `typeCheck: false` → `true` | 生产构建时开启类型检查，确保零错误上线 |
| `interface` vs `type` | 项目中统一用 `interface` 定义数据结构，`type` 用于联合类型（如 `role: 'user' \| 'assistant'`） |
| 类型守卫 | `err instanceof Error` 替代 `(err as Error).message`，运行时类型安全 |
| 泛型工具类型 | `Partial<ChatSession>` 用于部分更新，`Pick<ChatMessage, 'id' | 'content'>` 用于精简传递 |

#### 🤝 与 React 对照

| Vue 3 + TS | React + TS | 关键差异 |
|-----------|-----------|---------|
| `ref<T>(initial)` | `useState<T>(initial)` | Vue 泛型位置在函数名后，React 在前 |
| `computed<T>(fn)` | `useMemo<T>(fn, deps)` | Vue 自动依赖追踪，React 需 deps |
| `defineProps<Interface>()` | `function Component(props: Interface)` | Vue 用编译宏，React 用函数参数 |
| `defineEmits<EventMap>()` | `props: { onX: () => void }` | Vue 编译宏声明，React 用回调 props |
| — | `satisfies` 运算符 | TS 4.9+ 两者都支持 |
| InjectionKey\<T\> / provide/inject | Context<T> | 类型安全的跨层级传值 |

#### 🧠 面试题/常见坑

**Q1（AI 场景）：你的 `computed<ChatMessage[]>` 为什么用 `<ChatMessage[]>` 而不是让 TypeScript 自动推导？**

> A：在本项目中，`currentMessages` 的计算逻辑是 `activeSession.value?.messages ?? []`。TypeScript 从 `activeSession.value` 推导出 `messages` 为 `ChatMessage[] | undefined`，加上 `?? []` 后推导为 `ChatMessage[]`。在这个简单场景下自动推导是可以的。但在更复杂的场景（如链式 `?.` 访问 + 多种兜底），显式标注返回类型有两个好处：① **编译时检查**：如果返回值类型不匹配，立即报错；② **IDE 智能提示更精确**：在模板中使用 `currentMessages.value.xxx` 时能获得完整的属性提示。这在 AI 生成器的复杂数据流中很重要——一个类型错误可能导致 SSE 消息解析时静默失败。

**Q2（AI 场景）：`defineProps` 中如何处理 AI 返回的不确定字段（可能有 code 字段，也可能没有）？**

```typescript
// ChatMessage 接口中用 ? 标记可选字段
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  code?: string  // AI 生成的代码，可能不存在
}

// 使用时必须做存在性检查
const msg = currentMessages.value[0]
if (msg.code) {
  // msg.code 自动收窄为 string（非 undefined）
  previewCode.value = msg.code
}
```

**Q3：`ref<泛型>` 在 Nuxt SSR 中有什么坑？**

> Nuxt SSR 模式下，`ref<string>('')` 的类型在服务端和客户端是一致的。但要注意 `typeof localStorage !== 'undefined'` 这种环境判断。如果在 composable 顶层直接访问 `localStorage`，TypeScript 不会报错，但 SSR 运行时会抛 `ReferenceError`。正确做法是封装在函数内 + 环境判断。本项目在 `loadSessions()`、`saveSessions()` 中都做了 `typeof localStorage !== 'undefined'` 判断。

---

## 四、Nuxt 3 路由与布局系统

### 4.1 约定式路由 & 嵌套路由 & 动态路由

#### 💡 JS/浏览器/Node 基础补充

- **History API**：`pushState` / `replaceState` 实现客户端路由切换，不会触发页面刷新。Nuxt 3 的路由基于 Vue Router 4。
- **路由守卫导航流程**：`beforeEach` → `beforeResolve` → 组件 `onBeforeRouteLeave` → `afterEach`。
- **URL 编码规范**：动态路由参数中的特殊字符需要 `encodeURIComponent` 处理。

#### 🤖 AI 场景价值

AI 组件生成器的核心功能分布在 4 个页面：`/`（组件生成）、`/history`（历史会话）、`/library`（模板库）、`/settings`（设置）。Nuxt 的约定式路由让我们无需手动配置路由表，仅通过文件结构即可完成路由定义。配合 `layouts/default.vue` 的布局系统，实现了三栏布局（侧边导航 + 主内容 + 教学面板）的一致体验。

#### 📚 主线知识点原理解析

**Nuxt 3 约定式路由规则**：

```
pages/
├── index.vue          → /
├── history.vue        → /history
├── library.vue        → /library
├── settings.vue       → /settings
├── chat/
│   ├── index.vue      → /chat
│   └── [sessionId].vue → /chat/:sessionId（动态路由）
└── [...slug].vue      → /:pathMatch(.*)*（404 兜底）
```

**生成的路由表**：

```typescript
// Nuxt 自动生成的 vue-router 配置
[
  { path: '/', component: index.vue },
  { path: '/history', component: history.vue },
  { path: '/library', component: library.vue },
  { path: '/settings', component: settings.vue },
  { path: '/chat/:sessionId', component: chat/[sessionId].vue },
]
```

**布局系统**：

```
┌─────────────────────────────────────────────────────────┐
│  app.vue                                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │  <NuxtLayout>                                    │   │
│  │  ┌───────────────────────────────────────────┐  │   │
│  │  │  layouts/default.vue                       │  │   │
│  │  │  ┌─────┬─────────────┬───────────────┐    │  │   │
│  │  │  │     │             │               │    │  │   │
│  │  │  │  NuxtLink │  <slot />     │ 右侧面板   │    │  │   │
│  │  │  │  (SideNav)│  (page content)│  (Teaching) │    │  │   │
│  │  │  │     │             │               │    │  │   │
│  │  │  └─────┴─────────────┴───────────────┘    │  │   │
│  │  └───────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### 💻 代码实现（项目真实代码）

**`app.vue` - 布局入口**：

```vue
<template>
  <div>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
```

**`layouts/default.vue` - 三栏布局**：

```vue
<script setup lang="ts">
import SideNav from '~/components/SideNav.vue'

const route = useRoute()
const showSideNav = computed(() => !['/settings'].includes(route.path))
</script>

<template>
  <div class="h-screen flex bg-slate-50">
    <!-- 左侧：导航栏 -->
    <SideNav v-if="showSideNav" />
    <!-- 中间 + 右侧：主内容 -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <slot />
    </main>
  </div>
</template>
```

**`components/SideNav.vue` - 路由高亮**：

```typescript
const route = useRoute()

const navItems = [
  { key: 'generate', label: '组件生成', to: '/' },
  { key: 'history', label: '历史会话', to: '/history' },
  { key: 'library', label: '模板库', to: '/library' },
  { key: 'settings', label: '设置', to: '/settings' },
]

// 根据当前路由计算激活项
const activeKey = computed(() => {
  const path = route.path
  if (path === '/' || path === '') return 'generate'
  return navItems.find((t) => path.startsWith(t.to))?.key ?? 'generate'
})
```

**路由导航（`pages/library.vue`）**：

```typescript
const handleUseTemplate = (prompt: string) => {
  createNewSession()
  sendMessage(prompt)
  navigateTo('/')  // Nuxt 3 导航 API，支持 SSR
}
```

#### 📱 C 端生产化改造

| 改造项 | 说明 |
|--------|------|
| 路由懒加载 | Nuxt 3 默认自动按路由 code-splitting，每个页面一个 chunk |
| 路由中间件 | `middleware/auth.ts` 实现登录态检查，未登录跳转 `/login` |
| 动态路由 meta | `definePageMeta({ title: '历史会话', requiresAuth: true })` |
| 路由过渡动画 | `<NuxtPage :page-transition="{ name: 'fade', mode: 'out-in' }" />` |
| 404 页面 | 创建 `pages/[...slug].vue` 捕获所有未匹配路由 |
| 预取优化 | 在 `nuxt.config.ts` 中配置 `experimental.payloadExtraction` 优化 payload |

**路由中间件示例**（可拓展）：

```typescript
// middleware/auth.ts
export default defineNuxtRouteMiddleware((to, from) => {
  if (to.path === '/settings' && !isAuthenticated()) {
    return navigateTo('/')
  }
})
```

#### 🤝 与 React 对照

| Nuxt 3 | React Router v6 | 说明 |
|--------|-----------------|------|
| `pages/index.vue` → `/` | `<Route path="/" element={<Home/>}>` | Nuxt 约定式，React 声明式 |
| `<NuxtLink to="/">` | `<Link to="/">` | 语法类似 |
| `useRoute()` | `useLocation()` + `useParams()` | Nuxt 一个 hook 返回全部信息 |
| `navigateTo('/path')` | `useNavigate()` | Nuxt 全局 API，React 需 hook |
| `layouts/default.vue` | `Layout` 组件 + `<Outlet/>` | 布局容器 + 子路由出口 |
| `definePageMeta()` | — | Nuxt 专有页面元信息 |

#### 🧠 面试题/常见坑

**Q1（AI 场景）：用户在 AI 对话中途刷新页面，如何恢复会话状态？**

> A：三层恢复机制：① **localStorage 持久化**：`useChat.ts` 在每次会话操作后调用 `saveSessions()` 将全量会话写入 localStorage，页面刷新后 `loadOrCreateSession()` 从 localStorage 恢复；② **路由参数恢复**（可拓展）：`/chat/:sessionId` 动态路由，URL 中携带会话 ID，刷新后直接定位到指定会话；③ **SSR hydration**：如果用 Pinia + `nuxt-plugin`，可以在 SSR 时注入初始状态，客户端 hydration 无缝衔接。本项目用方案 ①，简单可靠。

**Q2（AI 场景）：如何实现路由级的「自动保存草稿」功能？**

```typescript
// middleware/draft.global.ts（全局前置中间件）
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/') {
    const draft = localStorage.getItem('ai-draft-input')
    if (draft) {
      // 恢复草稿到输入框
      // 通过事件或全局状态传递
    }
  }
})
```

**Q3：`layout` 中使用 `route.path` 做条件渲染有什么坑？**

> 在 `layouts/default.vue` 中，`showSideNav` 通过 `route.path` 判断是否显示侧边栏。坑点是：**路由变化时 `useRoute()` 返回的响应式对象会自动更新**，所以 `computed(() => !['/settings'].includes(route.path))` 会在路由切换时正确触发。但如果在非响应式上下文中（如普通函数）读取 `route.path`，需要使用 `route.fullPath` 或 `route.path` 的响应式版本。

---

## 五、Nuxt 3 数据预取

### 5.1 useFetch vs useAsyncData vs $fetch

#### 💡 JS/浏览器/Node 基础补充

- **HTTP 请求生命周期**：DNS → TCP → TLS → 请求 → 响应 → 解析。在 SSR 场景下，这些发生在 Node 服务端；CSR 场景下发生在浏览器端。
- **Hydration Mismatch**：SSR 渲染的 HTML 与客户端 CSR 渲染的 HTML 不一致，导致 Vue 在 hydration 阶段报错。常见原因是 `Math.random()`、`Date.now()`、`localStorage` 访问等。
- **SSR 安全检查**：`typeof window !== 'undefined'` 或 `import.meta.server` / `import.meta.client`。

#### 🤖 AI 场景价值

AI 组件生成器的核心请求是 **SSE 流式对话**（`useChat.ts` 中的 `sendMessage`），这是一个长连接、流式响应的场景。同时，历史会话列表、模板库等数据需要 SSR 预取。理解 `useFetch`/`useAsyncData`/`$fetch` 的区别，能帮我们在正确的场景使用正确的 API，避免 Hydration Mismatch 和性能问题。

#### 📚 主线知识点原理解析

**三大 API 对比**：

| 特性 | `useFetch` | `useAsyncData` | `$fetch` |
|------|-----------|----------------|----------|
| SSR 安全 | ✅ 自动 SSR | ✅ 自动 SSR | ⚠️ 需手动判断 |
| 缓存去重 | ✅ 相同 key 自动去重 | ✅ 相同 key 自动去重 | ❌ 无 |
| 响应式 | ✅ 返回 ref | ✅ 返回 ref + data/error | ❌ 返回 Promise |
| 生命周期 | 组件挂载时自动执行 | 需手动 `run()` 或 `immediate` | 立即执行 |
| 适用场景 | 页面级一次性请求 | 需要条件触发的请求 | 工具函数/Composable 内部 |

**选择决策树**：

```
需要在组件/页面中获取数据？
│
├─ 需要 SSR 预取 + 自动缓存
│  └─ useFetch('/api/xxx')
│     自动在 SSR 期间请求并注入 payload
│     客户端 hydration 时直接从 payload 读取
│
├─ 需要条件触发/手动刷新
│  └─ useAsyncData('key', () => fetch('/api/xxx'))
│     暴露 data, error, pending, refresh()
│
└─ 在 composable / 工具函数中调用
   └─ $fetch('/api/xxx')
      必须配合 import.meta.server 判断 SSR 环境
```

**Nuxt 3 数据获取流程**：

```
SSR 阶段:
  ┌──────────────┐
  │  useFetch()  │──→  Node 服务端发起请求
  │  useAsyncData│    结果序列化到 __NUXT__ payload
  └──────────────┘    生成带数据的 HTML
          ↓
  浏览器加载 HTML → Vue Hydration
          ↓
  CSR 阶段:
  ┌──────────────┐
  │  __NUXT__    │──→  客户端从 payload 读取缓存数据
  │  payload     │    不再重复请求（同一 key）
  └──────────────┘
          ↓
  用户交互触发:
  ┌──────────────┐
  │  $fetch()    │──→  客户端发起新请求（如 SSE 对话）
  └──────────────┘    完全在浏览器中执行
```

#### 💻 代码实现（项目真实代码）

**`composables/useChat.ts` 中的 SSE 对话（$fetch 替代 fetch）**：

```typescript
// 方案 A：原生 fetch + SSR 安全判断
const sendMessage = async (content: string) => {
  if (isLoading.value) return

  // 添加用户消息
  const userMsg: ChatMessage = { /* ... */ }
  addMessage(userMsg)

  const config = useRuntimeConfig()
  const response = await fetch(`${config.public.bffUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [...currentMessages.value.map(m => ({ role: m.role, content: m.content }))],
      stream: true,
    }),
  })

  // SSE 流式解析...
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    buffer += chunk

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue

      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content || ''
        if (delta) {
          fullContent += delta
          streamingContent.value = fullContent
          updateLastAssistant(fullContent)
        }
      } catch {}
    }
  }
}
```

**页面级 useFetch 示例**（可拓展的 `pages/library.vue`）：

```typescript
// 假设模板库需要从服务端预取
const { data: templates, error } = await useFetch<Template[]>(
  '/api/templates',
  {
    default: () => [],
    transform: (res) => res.data || [],
  }
)
```

**SSR 安全的 localStorage 访问**：

```typescript
// loadSessions() 中的环境判断
function loadSessions(): ChatSession[] {
  try {
    // ✅ SSR 安全：检查 localStorage 是否存在
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    }
  } catch {}
  return []
}
```

#### 📱 C 端生产化改造

| 问题 | 解决方案 |
|------|---------|
| Hydration Mismatch | ① 所有 `Math.random()` / `Date.now()` 在 `onMounted` 中执行；② `localStorage` 访问前加 `typeof` 判断；③ SSR 和 CSR 使用相同的初始状态 |
| SSE 断线重连 | 使用 `AbortController` 控制请求生命周期；断线后指数退避重试 |
| 大文件上传 | 使用 `useAsyncData` + `transform` 处理进度；或用 `$fetch` + `onUploadProgress` |
| 并发请求去重 | 同一 key 的 `useFetch` 自动去重；不同 key 的请求在 Nuxt 中并行执行 |
| 数据预取失效 | 使用 `refresh()` 或 `refreshNuxtData()` 主动刷新缓存 |

**Hydration Mismatch 典型场景**：

```typescript
// ❌ 错误：在 setup 中直接访问 localStorage
const savedKey = localStorage.getItem('key')  // SSR 报错

// ❌ 错误：在 setup 中使用 Math.random
const randomId = Math.random().toString(36)  // SSR 和 CSR 结果不同

// ✅ 正确：在 onMounted 中访问
onMounted(() => {
  const savedKey = localStorage.getItem('key')
})

// ✅ 正确：使用 computed 惰性计算
const randomId = computed(() => Math.random().toString(36))
```

#### 🤝 与 React 对照

| Nuxt 3 | React (Next.js) | React (SPA) |
|--------|-----------------|-------------|
| `useFetch()` | `useSWR()` / `useQuery()` (TanStack) | 自定义 hook |
| `useAsyncData()` | `useSWR()` + `revalidate` | 自定义 hook |
| `$fetch()` | `fetch()` / `axios` | `fetch()` / `axios` |
| SSR 预取内置 | `getServerSideProps` / Server Components | 需手动 SSR |
| Payload 缓存 | SWR 的 `cache` | 需自行实现 |

#### 🧠 面试题/常见坑

**Q1（AI 场景）：你的 SSE 对话请求为什么用原生 `fetch` 而不是 `useFetch` 或 `$fetch`？**

> A：三个原因：① **SSE 是长连接流式响应**：`useFetch` 和 `$fetch` 内部封装了 JSON 解析和自动 unwrap，不支持 `ReadableStream` 的 `getReader()` 流式读取；② **需要细粒度控制**：SSE 需要手动 `reader.read()` + `TextDecoder` + `split('\n')` 粘包处理，原生 `fetch` 提供了完整的 `ReadableStream` API；③ **SSR 不发起 SSE**：`sendMessage` 只在用户点击按钮时触发（完全在 CSR 阶段），不需要 SSR 预取，所以用原生 `fetch` 就好。

**Q2（AI 场景）：`useChat.ts` 中 `loadSessions()` 的 `typeof localStorage !== 'undefined'` 判断的原理？**

> A：这是 SSR 安全的经典模式。Nuxt SSR 期间，代码在 Node.js 中执行，`localStorage` 是浏览器 API，在 Node 中不存在。如果直接访问 `localStorage.getItem('key')` 会抛出 `ReferenceError: localStorage is not defined`。`typeof` 的特殊之处在于：对不存在的变量使用 `typeof` 不会抛出错误，而是返回字符串 `'undefined'`。这与直接访问 `localStorage` 的行为不同。同时，`try/catch` 包裹是为了处理 `localStorage` 可能被禁用（隐私模式）或 `JSON.parse` 失败的情况。

**Q3（AI 场景）：如何在 AI 对话中实现「取消生成」功能？**

```typescript
const abortController = ref<AbortController | null>(null)

const sendMessage = async (content: string) => {
  abortController.value = new AbortController()

  const response = await fetch(url, {
    method: 'POST',
    signal: abortController.value.signal,  // 传入 signal
  })
  // ...
}

const cancelGeneration = () => {
  abortController.value?.abort()
  isLoading.value = false
}
```

---

## 六、Nuxt 3 插件与模块

### 6.1 plugins/*.server|client.ts 执行顺序

#### 💡 JS/浏览器/Node 基础补充

- **ESM 模块加载顺序**：按文件名字母序加载（`01-plugin.ts` → `02-plugin.ts`），相同前缀的 `.server.ts` / `.client.ts` 按顺序执行。
- **Node.js 服务端 vs 浏览器客户端**：Nuxt 3 通过文件扩展名区分执行环境，`.server.ts` 仅在 Node 中执行，`.client.ts` 仅在浏览器中执行。
- **`process.env` vs `import.meta.env`**：Node 用 `process.env`，Vite 客户端用 `import.meta.env`，Nuxt 统一为 `useRuntimeConfig()`。

#### 🤖 AI 场景价值

AI 组件生成器需要配置 BFF 服务地址、API Key、第三方 SDK 等。Nuxt 的 `runtimeConfig` 让我们可以在 `nuxt.config.ts` 中定义环境变量，然后在插件和组件中通过 `useRuntimeConfig()` 类型安全地读取。同时，`.server.ts` 插件可以在服务端注入 AI SDK 实例，`.client.ts` 插件可以注入前端监控 SDK。

#### 📚 主线知识点原理解析

**Nuxt 3 插件执行时序**：

```
┌─────────────────────────────────────────────────────────┐
│  Nuxt 应用启动                                            │
│                                                         │
│  1. nuxt.config.ts 加载                                  │
│     ├── runtimeConfig 解析                               │
│     ├── modules 加载（Pinia、Tailwind 等）               │
│     └── 注册全局钩子                                      │
│                                                         │
│  2. plugins/*.server.ts 执行（仅 SSR）                   │
│     ├── 01-init.server.ts → 初始化服务端 SDK              │
│     └── 02-cache.server.ts → 初始化缓存                   │
│                                                         │
│  3. SSR 渲染                                             │
│     ├── useFetch / useAsyncData 数据预取                 │
│     ├── 组件 setup 执行                                  │
│     └── 生成 HTML + payload                              │
│                                                         │
│  4. 客户端加载                                            │
│     ├── plugins/*.client.ts 执行（仅 CSR）               │
│     │   ├── 01-init.client.ts → 初始化客户端 SDK          │
│     │   └── 02-analytics.client.ts → 注入埋点            │
│     ├── Hydration（水合）                                │
│     └── 路由挂载                                         │
│                                                         │
│  5. 导航到新路由                                          │
│     └── plugins 不重复执行（全局插件只执行一次）            │
└─────────────────────────────────────────────────────────┘
```

**`runtimeConfig` 环境变量分层**：

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    // 服务端专用：不会暴露到客户端
    bffUrl: process.env.BFF_URL || 'http://localhost:3001',
    // 客户端可见：通过 public 字段暴露
    public: {
      appName: 'AI 组件生成器',
      apiBase: process.env.BFF_URL || 'http://localhost:3001',
    },
  },
})
```

**Nitro 服务端 API**：

```typescript
// server/api/chat.post.ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const config = useRuntimeConfig()

  // 服务端直接读 config（包括私有字段）
  const response = await fetch(`${config.bffUrl}/api/chat`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

  return sendStream(event, response)
})
```

#### 💻 代码实现（项目真实代码）

**`nuxt.config.ts` - runtimeConfig 配置**：

```typescript
export default defineNuxtConfig({
  ssr: true,

  runtimeConfig: {
    // 服务端私有：仅 Nitro 服务端 API 可访问
    bffUrl: process.env.BFF_URL || 'http://localhost:3001',
    public: {
      // 客户端可见：组件和 CSR 代码可通过 runtimeConfig.public 访问
      appName: 'AI 组件生成器',
    },
  },

  modules: [
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
  ],

  // Nitro 服务端配置
  nitro: {
    routeRules: {
      '/api/**': { proxy: 'http://localhost:3001' },
    },
  },
})
```

**组件中读取配置**：

```typescript
// pages/settings.vue
const config = useRuntimeConfig()

onMounted(() => {
  // ✅ 类型安全：config.public 是 Nuxt 自动生成的类型
  apiEndpoint.value = config.public.bffUrl || ''
})

// composables/useChat.ts
const config = useRuntimeConfig()
const response = await fetch(`${config.public.bffUrl}/api/chat`, { /* ... */ })
```

**可拓展的 Server 插件示例**：

```typescript
// plugins/01-ai-sdk.server.ts
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()

  const aiSdk = createAISDK({
    endpoint: config.bffUrl,
    timeout: 30000,
  })

  nuxtApp.provide('aiSdk', aiSdk)
})

// server/api/generate.post.ts（使用注入的 SDK）
export default defineEventHandler(async (event) => {
  const nuxtApp = useNuxtApp()
  const aiSdk = nuxtApp.inject('aiSdk')

  const { prompt } = await readBody(event)
  const result = await aiSdk.generate(prompt)

  return result
})
```

#### 📱 C 端生产化改造

| 改造项 | 说明 |
|--------|------|
| 环境变量分层 | 严格区分 `runtimeConfig`（服务端）和 `runtimeConfig.public`（客户端），防止密钥泄露 |
| `.env` 文件 | 开发环境用 `.env`，生产环境用 CI/CD 注入环境变量 |
| Server 插件 | 数据库连接池、Redis 连接、AI SDK 实例等重型资源放在 `.server.ts` 插件中，仅初始化一次 |
| Client 插件 | 前端监控（Sentry）、埋点（Analytics）、Service Worker 注册等放在 `.client.ts` 插件中 |
| Nitro API | 所有后端逻辑通过 `server/api/*.ts` 暴露，支持 HMR，与前端代码一体化开发 |
| 插件命名 | `01-xxx.server.ts` → `02-xxx.server.ts` 显式控制执行顺序 |

#### 🤝 与 React 对照

| Nuxt 3 | Next.js (React) | Vite + React SPA |
|--------|-----------------|------------------|
| `plugins/*.server.ts` | Server Components / `getServerSideProps` | Node 环境变量 |
| `plugins/*.client.ts` | `useEffect` + `typeof window` | `useEffect` + `typeof window` |
| `runtimeConfig.public` | `NEXT_PUBLIC_*` 环境变量 | `VITE_*` 环境变量 |
| `runtimeConfig`（私有） | 仅在 Server Components 可用 | 不可行（无 SSR） |
| Nitro `server/api/*` | Next.js API Routes | 需独立后端 |
| `defineNuxtPlugin` | 无直接等价 | 无直接等价 |

#### 🧠 面试题/常见坑

**Q1（AI 场景）：为什么 `useChat.ts` 中用 `config.public.bffUrl` 而不是直接读 `process.env.BFF_URL`？**

> A：三个原因：① **SSR/CSR 一致性**：`useRuntimeConfig()` 在 SSR 和 CSR 中返回的值一致，`process.env` 在客户端不可用；② **类型安全**：Nuxt 为 `runtimeConfig.public` 生成 TypeScript 类型，`config.public.bffUrl` 有完整的 IDE 提示；③ **构建时确定**：`runtimeConfig.public` 的值在构建时注入 HTML 的 `__NUXT__` payload 中，客户端 hydration 时直接读取，无需再次解析环境变量。如果在客户端代码中使用 `process.env.BFF_URL`，Vite 构建时会报错（`process is not defined`）。

**Q2（AI 场景）：如何设计一个支持 AI 流式响应的 Nitro Server API？**

```typescript
// server/api/chat.post.ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const config = useRuntimeConfig()

  // 设置 SSE 响应头
  setResponseHeader(event, 'Content-Type', 'text/event-stream')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')

  // 代理到 BFF 服务
  const response = await fetch(`${config.bffUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  })

  // 流式转发
  if (!response.body) return createError({ statusCode: 500 })

  return sendStream(event, response)
})
```

**Q3（AI 场景）：如何避免在前端代码中暴露 AI API Key？**

> 绝对不要把 API Key 放在 `runtimeConfig.public` 中！正确做法：
>
> 1. API Key 仅存放在服务端环境变量（`process.env.API_KEY`）
> 2. 通过 `runtimeConfig`（私有字段）在服务端读取
> 3. 前端请求 Nitro Server API（`/api/chat`），由 Nitro 代理到 AI 服务
> 4. 前端只与自己的 Nitro 通信，完全不接触 API Key
>
> ```
> 前端 → Nitro Server（/api/chat） → AI 服务（带 API Key）
> ```
>
> 本项目的 `settings.vue` 中允许用户输入 API Key 到 localStorage，这只是开发模式下的便捷功能，生产环境应移除。

---

## 总结：AI 组件生成器中的 Vue3/Nuxt3 全景

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AI 组件生成器架构                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Nuxt 3 布局层                                               │    │
│  │  layouts/default.vue → 三栏布局                              │    │
│  │  ┌──────┬──────────────────────────────┬─────────────────┐  │    │
│  │  │      │                              │                 │  │    │
│  │  │ SideNav│     页面内容                   │  TeachingPanel  │  │    │
│  │  │      │  ┌────────────────────────┐  │  技术拆解       │  │    │
│  │  │      │  │ useChat() composable  │  │  面试考点       │  │    │
│  │  │      │  │ ├─ sessions (ref)     │  │                 │  │    │
│  │  │      │  │ ├─ currentMessages    │  │                 │  │    │
│  │  │      │  │ ├─ isLoading (ref)    │  │                 │  │    │
│  │  │      │  │ └─ sendMessage()    │  │                 │  │    │
│  │  │      │  │     └─ SSE 流式解析  │  │                 │  │    │
│  │  │      │  └────────────────────────┘  │                 │  │    │
│  │  │      │                              │                 │  │    │
│  │  └──────┴──────────────────────────────┴─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Nuxt 3 数据层                                               │    │
│  │  ├─ useFetch / useAsyncData（SSR 预取）                      │    │
│  │  ├─ $fetch（CSR 请求）                                       │    │
│  │  └─ runtimeConfig（环境变量管理）                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Nitro 3 服务端                                              │    │
│  │  └─ server/api/chat.post.ts → SSE 代理                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 知识点速查表

| # | 知识点 | 核心文件 | 关键 API |
|---|--------|---------|----------|
| 1 | Composition API 工程化 | `composables/useChat.ts` | `useChat()`、模块级单例 |
| 2 | 响应式进阶 | `composables/useChat.ts` | `ref<T>`、`computed<T>`、`shallowRef` |
| 3 | TS 实战 | `ChatBubble.vue`、`ChatInput.vue` | `defineProps<Interface>()`、`defineEmits` |
| 4 | 路由与布局 | `layouts/default.vue`、`SideNav.vue` | `useRoute()`、`NuxtLink`、`navigateTo()` |
| 5 | 数据预取 | `useChat.ts`、`settings.vue` | `useRuntimeConfig()`、`fetch`、SSE |
| 6 | 插件与模块 | `nuxt.config.ts`、`server/api/` | `runtimeConfig`、Nitro API |

### 面试频率统计（AI 产品场景）

| 知识点 | AI 面试频率 | 典型场景 |
|--------|------------|---------|
| Composition API 工程化 | ⭐⭐⭐⭐⭐ | AI 对话 composable 设计 |
| 响应式进阶 | ⭐⭐⭐⭐ | SSE 流式性能优化 |
| TS 实战 | ⭐⭐⭐⭐ | 类型安全的 AI 返回值处理 |
| 路由与布局 | ⭐⭐⭐ | 多会话历史恢复 |
| 数据预取 | ⭐⭐⭐⭐⭐ | SSE + SSR + Hydration |
| 插件与模块 | ⭐⭐⭐ | API Key 安全设计 |