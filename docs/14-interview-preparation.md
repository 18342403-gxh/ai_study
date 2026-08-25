# AI 组件生成器 · 面试题满分解答

> 本文档涵盖项目全部 43 个高频面试题，每题给出结构化满分解答。
> 建议口述时结合代码实际实现，每个答案控制在 3-5 分钟。

---

## 第一部分：项目整体架构（Q1-Q5）

### Q1：为什么用 pnpm Monorepo 而不是分别建多个仓库？shared 包里放了什么？

**参考答案：**

选择 Monorepo 主要出于三个原因：

1. **类型共享**：前端（React 和 Vue）都需要使用 `ChatMessage`、`RagDocument`、`AgentState` 这些类型。如果用多仓库，每个前端都要自己定义一份，很容易不一致。通过 `packages/shared` 统一维护类型定义，保证前后端、两套前端的类型完全一致。
2. **依赖管理**：TypeScript 配置、ESLint 规则这些可以在根目录统一配置，避免每个子项目各配一份。
3. **开发体验**：`pnpm --filter` 可以精确控制在哪个工作区执行命令，比如只跑 server 的测试。

shared 包里放了：
- `types/` — chat.ts（消息/会话）、rag.ts（文档/查询/事件）、tools.ts（工具定义）、agent.ts（Agent 状态/事件）、generator.ts（代码生成器状态）、session.ts、api-response.ts
- `constants/api.ts` — 所有 API 端点常量，前后端统一引用

```
packages/shared/src/
  ├── index.ts          # 统一导出
  ├── constants/api.ts  # API 端点常量
  └── types/            # 类型定义
```

---

### Q2：描述一下你的目录结构，apps/ 和 packages/ 怎么划分的？

**参考答案：**

```
ai_study/
├── apps/                       # 应用层，可独立部署
│   ├── server/                 #   Express BFF 后端 (port 3001)
│   ├── web-react/              #   React + Vite 前端 (port 5173)
│   └── web-vue-nuxt/           #   Vue 3 + Nuxt 3 前端 (port 3000)
├── packages/                   # 共享层，不可独立部署
│   └── shared/                 #   跨端类型定义
└── package.json                # pnpm workspace 根配置
```

划分原则：
- `apps/` 放完整的可部署应用，每个都是独立的技术栈
- `packages/` 放跨应用复用的代码，不含业务逻辑
- workspace 配置通过 `@ai-study/shared` 别名引用共享包

---

### Q3：为什么同时做了 React 和 Vue 两套前端？

**参考答案：**

这是一个学习项目，做两套前端是为了：
1. **对比学习**：同一套后端 API，用两种框架分别实现一遍，能深刻体会两者的差异。比如 React 的 useState/useEffect vs Vue 的 ref/computed，React 的 Context vs Vue 的 Provide/Inject。
2. **技术验证**：确保后端的 API 设计框架无关，任何前端框架都能轻松接入。
3. **就业准备**：面试时可以展示跨框架能力，说明"同一个后端，我可以同时支持 React 和 Vue"。

两套前端调用的 API 完全一致，只是 UI 框架和组件写法不同。

---

### Q4：BFF 模式是什么？你的 Express 层在中间起什么作用？

**参考答案：**

BFF（Backend for Frontend）是一种架构模式，指在业务后端服务和前端之间增加一层，专门为前端需求定制的后端层。

我的 Express BFF 起四个作用：
1. **API 聚合**：前端不需要知道 AI 提供商的具体 API 格式，只需要调 BFF 的 `/api/chat/completions`、`/api/rag/query` 等接口。BFF 内部处理和 AI 提供商的协议转换。
2. **密钥保护**：API Key 只存在 BFF 的 `process.env` 中，前端代码零密钥痕迹，不会被打包进 JS bundle。
3. **数据格式化**：AI 返回的原始格式和前端需要的格式不同，BFF 负责转换。比如把 AI 的 SSE 流解析成 `{type: 'delta', content}` 格式推给前端。
4. **业务逻辑下沉**：RAG 管道（分块、向量化、检索）、Agent 状态机、工具调用这些逻辑都在 BFF 层，前端只负责展示。

---

### Q5：项目的数据流是怎样的？

**参考答案：**

以一次完整的 AI 对话为例：

```
用户输入 "帮我生成一个搜索组件"
        │
        ▼
  前端 (Nuxt/React)
  1. useChat.sendMessage()
  2. fetch POST /api/chat/completions
  3. 请求体: { messages: [...], stream: true }
        │
        ▼
  BFF (Express :3001)
  1. Zod 校验参数
  2. 根据是否有知识库，构建不同的 prompt
  3. 调用 AI 提供商 API (stream: true)
  4. 接收 AI 的 SSE 流，解析成统一格式
  5. 转发给前端
        │
        ▼
  AI 提供商 API
  1. 接收请求
  2. 流式返回 token: data: {choices:[{delta:{content:"搜"}}]}
        │
        ▼
  前端接收 SSE 流
  1. ReadableStream 逐块读取
  2. 解析 data: 前缀、处理 [DONE]
  3. 实时渲染打字机效果
  4. 流式写入 localStorage 会话
```

---

## 第二部分：后端 Express 部分（Q6-Q10）

### Q6：中间件体系是怎么设计的？

**参考答案：**

```
请求 → logger → validate → 路由处理 → errorHandler → 响应
```

- **logger.ts**：请求开始时记录 method、url、时间戳，响应结束时计算耗时。方便排查性能问题。
- **validate.ts**：用 Zod schema 定义请求参数校验规则，通过 `validate(schema)` 返回中间件，自动校验 body/query/params。校验失败直接返回 400，不进入业务逻辑。
- **errorHandler.ts**：全局错误处理中间件，捕获业务异常，统一返回 `{ error: { message, code } }` 格式。区分业务错误（4xx）和系统错误（5xx）。

优势：每个中间件职责单一，可灵活组合。新路由只需 `router.post('/xx', validate(schema), handler)` 即可。

---

### Q7：Zod 校验是怎么做的？

**参考答案：**

在 `middleware/validate.ts` 中定义了通用的校验中间件工厂函数：

```
export function validate(schema: { body?: z.ZodType; query?: z.ZodType }) {
  return (req, res, next) => {
    // 校验 body
    if (schema.body) {
      const result = schema.body.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({ error: result.error.issues })
      }
      req.body = result.data  // 用清洗后的数据替换
    }
    // 校验 query 同理
    next()
  }
}
```

使用示例（chat 路由）：
```
const chatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user','assistant','system']), content: z.string() })),
  stream: z.boolean().default(true),
})
router.post('/completions', validate({ body: chatSchema }), asyncHandler(chatHandler))
```

好处：运行时类型安全，TypeScript 编译时也能推断类型，校验逻辑可复用。

---

### Q8：SSE 流式响应是怎么实现的？

**参考答案：**

核心流程：
1. 设置响应头：`res.setHeader('Content-Type', 'text/event-stream')`，`res.setHeader('Cache-Control', 'no-cache')`
2. 调用 AI 提供商的流式 API，获取 `ReadableStream`
3. 逐块读取，解析后写入 `res.write('data: ' + JSON.stringify(event) + '\n\n')`
4. 流结束时调用 `res.end()`

关键点：
- **`\n\n` 分隔**：SSE 规范要求每条事件用双换行分隔
- **客户端断开检测**：监听 `req.on('close')`，如果客户端断开则中断流读取，避免资源浪费
- **心跳保活**：长时间无数据时发送 `: ping\n\n` 保持连接

---

### Q9：SQLite 选了 6 张表，为什么不用别的数据库？

**参考答案：**

6 张表：documents（文档）、chunks（分块）、sessions（会话）、messages（消息）、agent_states（Agent 状态）、tool_calls（工具调用记录）。

选 SQLite 的原因：
1. **零运维**：文件型数据库，不需要安装数据库服务，项目 clone 下来直接跑
2. **学习项目够用**：数据量不大（个人使用，文档和会话不会很多）
3. **本地优先**：知识库数据和 Agent 状态都是本地使用，不需要分布式
4. **better-sqlite3** 支持 WAL 模式，读写并发性能不错

如果数据量变大，迁移路径：
- SQLite → PostgreSQL/MySQL：schema 基本兼容，改连接配置即可
- 向量存储部分可以单独迁到 pgvector 或 Milvus

---

### Q10：documents 和 chunks 表的外键约束是怎么处理的？

**参考答案：**

chunks 表有 `doc_id` 外键指向 documents 表。上传文档时，必须保证 **先插入 documents，再插入 chunks**，否则外键约束会报错。

我实际踩过这个坑：最开始是先调向量化（生成 chunks）再写 documents，结果 FOREIGN KEY constraint failed。修复方式是调整写入顺序：

```
// 1. 先写 documents 表（状态为 processing）
db.prepare('INSERT INTO documents ...').run(documentId, ...)

// 2. 再调向量化（chunks 引用 documentId）
const doc = await ragService.ingestFromFileWithId(filePath, name, documentId)

// 3. 更新 documents 状态为 ready
db.prepare('UPDATE documents SET status = ? WHERE id = ?').run('ready', documentId)
```

删除文档时，SQLite 的 `ON DELETE CASCADE` 会自动删除关联的 chunks。

---

## 第三部分：RAG 知识库（Q11-Q18）

### Q11：描述一下完整的 RAG 管道流程

**参考答案：**

```
用户上传文档
    │
    ▼
① Document Loader 文档加载
   ├── .txt → 直接读取
   ├── .md → 读取 + 保留 markdown 格式
   ├── .json → 读取并解析
   └── .csv → 读取并按行组织
    │
    ▼
② Text Splitter 文本分块
   ├── 按字符数分块（默认 500 字符）
   ├── 带 50 字符 overlap（防止句子被切断）
   └── 每块生成唯一 ID
    │
    ▼
③ Embedding 向量化
   ├── 调用 Embedding API（如 bge-large-zh）
   ├── 每个 chunk 生成 1024 维向量
   └── 批量处理，减少 API 调用次数
    │
    ▼
④ Vector Store 向量存储
   ├── 写入 SQLite vectors 表
   ├── 存储 id、content、metadata、embedding（JSON）
   └── 关联 document_id
    │
    ▼
⑤ Retrieval 检索查询
   ├── 用户提问 → 同样做 Embedding
   ├── 计算余弦相似度
   ├── 返回 top-K 最相关的 chunks
   └── 分数阈值过滤
    │
    ▼
⑥ Generation 生成回答
   ├── 把检索到的片段拼进 prompt
   ├── 发送给 AI 生成回答
   └── 返回回答 + 引用来源
```

---

### Q12：文档分块策略是怎样的？

**参考答案：**

采用**固定长度分块 + overlap** 策略：

- **分块大小**：500 字符（中文约 250-300 字）
- **Overlap**：50 字符（相邻块重叠，防止句子在边界被切断）
- **分块依据**：按字符数而不是按词，实现简单且效果稳定

选择 500 字符的原因：
- 太小（<100）：上下文不足，检索出来的片段语义不完整
- 太大（>1000）：检索时会引入过多无关内容，干扰 AI 回答
- 500 是经验值，兼顾语义完整性和检索精度

优化方向：可以尝试按段落/句子分块，或者用语义分割（Embedding 计算相邻句的相似度，低于阈值则切分）。

---

### Q13：Embedding 用的什么方案？

**参考答案：**

使用的是 **bge-large-zh** 模型（通过 AI API 调用，本地不部署）。

- **向量维度**：1024 维
- **模型选择**：专门针对中文优化的 Embedding 模型，在中文语义相似度任务上表现好
- **调用方式**：批量处理，一次可以 embedding 多个文本，减少 API 调用次数
- **API Key**：存在 BFF 的 `.env` 文件中，前端不可见

选择云端 Embedding 而不是本地模型的原因：
1. 本地部署 bge-large-zh 需要 GPU 资源
2. 学习项目规模小，调用量不大，API 成本可接受
3. 可以快速切换模型（比如换成 text-embedding-3-small）

---

### Q14：向量存储怎么实现的？

**参考答案：**

用 SQLite 的 JSON 列存储 embedding 向量。

表结构：
```sql
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding TEXT  -- JSON 存储向量数组
);
```

相似度搜索：把 embedding JSON 解析成数组，用余弦相似度公式计算：

```
cos_sim(A, B) = (A·B) / (|A| × |B|)
```

实现方式：
1. 取出所有 chunks 的 embedding
2. 在内存中计算余弦相似度
3. 排序取 top-K

这是最简单的向量搜索实现。数据量大了之后可以：
- 用 HNSW 算法（近似最近邻）
- 换成 pgvector、Milvus、FAISS 等专业向量库

---

### Q15：RAG 查询的完整流程？

**参考答案：**

```
用户提问 "组件生成器用什么技术栈？"
    │
    ▼
① Embedding 用户问题
   将问题文本转换为 1024 维向量
    │
    ▼
② 向量检索
   计算与所有 chunks 的余弦相似度
   过滤 score > 0.3 的结果
   按相似度排序，取 top-K（默认 4）
    │
    ▼
③ 构建 Prompt
   System: "你是一个基于知识库回答问题的助手。只根据提供的上下文回答，不要编造。"
   Context: [chunk1.content, chunk2.content, chunk3.content, chunk4.content]
   User: "组件生成器用什么技术栈？"
    │
    ▼
④ 调用 AI 生成回答（流式）
   实时把 delta 推送给前端
    │
    ▼
⑤ 返回结果
   先推 retrieval 事件（sources 列表）
   再推 delta 流（逐 token）
   最后推 done 事件
```

---

### Q16：怎么处理文档删除？

**参考答案：**

删除流程：
1. 前端调 `DELETE /api/rag/documents/:id`
2. BFF 先删 chunks（通过 SQLite CASCADE 自动处理，或手动先删）
3. 再删 documents 记录
4. 返回删除成功

级联删除：建表时用 `ON DELETE CASCADE`，删除 documents 时 SQLite 自动删除关联的 chunks，不需要手动维护。

注意：向量存储中 embedding 以 JSON 存在 chunks 表里，不需要额外清理向量库。如果用了专业向量库（如 Milvus），则需要在删除时同步调用向量库的删除 API。

---

### Q17：Top-K 参数是什么意思？

**参考答案：**

Top-K 指检索时返回最相关的 K 条文档片段。

- **K 太小（1-2）**：可能遗漏关键信息，导致回答不完整
- **K 太大（8-10）**：会引入无关内容，干扰 AI 回答，浪费 token
- **推荐值**：4-6

其他相关参数：
- **Score threshold**：相似度分数阈值，低于阈值的片段直接过滤掉（比如设 0.3）
- **Top-K 和阈值配合**：先按阈值过滤，再从剩余的取 top-K

用户可以在 RAG 查询页面的下拉框调整 Top-K 参数。

---

### Q18：引用来源是怎么返回给前端的？

**参考答案：**

SSE 事件协议中，**第一条事件就是检索结果**，然后才是回答流：

```
data: {"type":"retrieval","sources":[{"index":1,"content":"...","score":0.85},{"index":2,"content":"...","score":0.72}]}

data: {"type":"delta","content":"组件生成器"}
data: {"type":"delta","content":"使用"}
data: {"type":"delta","content":"Nuxt"}
...
data: {"type":"done"}
```

前端收到 retrieval 事件后立即展示参考来源列表（文档片段 + 相似度分数），让用户在看回答之前就知道 AI 基于哪些内容回答的。回答流通过 delta 事件逐步渲染，实现打字机效果。

---

## 第四部分：Agent 状态机 + Function Calling（Q19-Q28）

### Q19：Agent 的 4 个节点是怎么流转的？

**参考答案：**

```
              ┌──────────────┐
              │    think      │  AI 分析用户意图，决定是否需要调用工具
              └──────┬───────┘
                     │
              需要工具？
              ┌───┴───┐
             Yes      No
              │        │
              ▼        ▼
     ┌──────────────┐  │
     │ call_tools  │  │  直接生成回答
     └──────┬───────┘  │
            │          │
            ▼          │
     ┌──────────────┐  │
     │   observe    │  │
     │  观察工具结果 │  │
     └──────┬───────┘  │
            │          │
            ▼          ▼
     ┌──────────────────────┐
     │       answer         │  基于观察结果生成最终回答
     └──────────────────────┘
```

流转规则：
- think → call_tools：AI 决定需要外部信息时
- think → answer：AI 认为可以直接回答时
- call_tools → observe：工具执行完成
- observe → think：需要更多工具（循环）
- observe → answer：信息充足，可以回答了
- answer → 结束：输出最终回答

---

### Q20：StateGraph 是什么？

**参考答案：**

StateGraph 是 LangGraph 中的核心抽象，用于定义 Agent 的状态流转图。

相比 if-else 条件分支的优势：
1. **可中断可恢复**：可以在任意节点暂停，保存状态，之后从断点恢复（pause/resume）
2. **可观测**：每个节点的输入输出都被记录，可以查看完整的推理链路
3. **可迭代**：支持循环（think → call_tools → observe → think），实现多步推理
4. **可回滚**：支持从历史状态回滚到任意节点重新开始

我的实现：
```
const graph = new StateGraph(initialState)
  .addNode('think', thinkNode)
  .addNode('call_tools', callToolsNode)
  .addNode('observe', observeNode)
  .addNode('answer', answerNode)
  .addEdge('think', 'call_tools', needsTools)  // 条件边
  .addEdge('think', 'answer', noTools)          // 条件边
  .addEdge('call_tools', 'observe')             // 普通边
  .addEdge('observe', 'think', needMore)        // 条件边（循环）
  .addEdge('observe', 'answer', enough)         // 条件边
  .compile()
```

---

### Q21：Agent 的 SSE 事件有哪些类型？

**参考答案：**

按 streamEvents v2 协议：

| 事件类型 | 触发时机 | 数据内容 |
|---------|---------|---------|
| `thread_id` | Agent 启动时 | `{threadId}` 唯一会话 ID |
| `on_chain_start` | 每个节点开始执行 | `{name: 'think', data: {iteration: 1}}` |
| `on_chain_stream` | 节点产生流式输出 | `{name: 'think', data: '正在分析'}` |
| `on_chain_end` | 节点执行完成 | `{name: 'think', data: {content: '思考结果'}}` |
| `on_tool_start` | 工具开始执行 | `{name: 'get_weather', data: {city: '北京'}}` |
| `on_tool_end` | 工具执行完成 | `{name: 'get_weather', data: {temp: 25}}` |
| `on_interrupt` | Agent 被暂停 | `{reason: 'user_paused'}` |
| `on_error` | 执行出错 | `{message: 'API call failed'}` |
| `done` | Agent 运行结束 | `{threadId}` |

前端根据事件类型更新 UI：on_chain_start 更新阶段状态，on_chain_stream 追加打字机内容，on_tool_start/end 展示工具调用列表。

---

### Q22：Agent 怎么决定什么时候调用工具？

**参考答案：**

这完全由 AI 大模型通过 Function Calling 机制自主决定，不是规则写死的。

具体流程：
1. **System Prompt 告知 AI 可用工具**：在 system prompt 中列出所有工具的 name、description、parameters schema
2. **AI 自主判断**：AI 收到用户问题后，分析是否需要外部信息
   - 需要查天气 → 决定调用 `get_weather`
   - 需要搜文档 → 决定调用 `search_documents`
   - 简单问候 → 直接回答，不调工具
3. **AI 返回 tool_calls**：在 API 响应中，AI 的 message 包含 `tool_calls` 字段
4. **服务端解析执行**：检测到 tool_calls 后，解析出工具名和参数，执行后把结果作为 `tool` role 的 message 回传给 AI
5. **AI 基于结果继续推理**：形成闭环

这就是 ReAct（Reason + Act）范式：AI 先推理（ReAct），再行动（Act），观察结果后再推理。

---

### Q23：pause/resume/rollback 是怎么实现的？

**参考答案：**

**Pause 暂停**：
1. 前端调 `POST /api/agent/pause`
2. BFF 调用 LangGraph 的 `thread.interrupt()` 方法
3. Agent 在当前节点执行完后停止，状态保存到 `agent_states` 表
4. 状态字段：status 改为 'paused'，保存当前 thread_id 和 state_json

**Resume 恢复**：
1. 前端调 `POST /api/agent/resume` 带 threadId
2. 从 agent_states 表读取保存的状态
3. 调用 LangGraph 的 `thread.resume()` 方法
4. Agent 从暂停点的下一个节点继续执行

**Rollback 回滚**：
1. 前端调 `POST /api/agent/rollback` 带 threadId 和 step
2. 从 agent_states 表读取历史状态快照
3. 回滚到指定 step 的状态
4. 可以从该节点重新开始执行

状态持久化是通过 SQLite 的 agent_states 表实现的，每次节点转换时保存快照。

---

### Q24：如果 Agent 陷入死循环怎么办？

**参考答案：**

用 **maxIterations 限制**防止死循环。

在 Agent 的 StateGraph 中设置计数器：
1. 每次进入 think 节点时，iteration 计数 +1
2. 在条件边的判断函数中检查：
   ```
   function shouldStop(state) {
     if (state.iteration >= maxIterations) return true  // 强制结束
     return state.needsMoreTools ? false : true
   }
   ```
3. 达到最大迭代次数后，直接跳转到 answer 节点，用已有信息生成回答或告知用户"无法得出结论"

默认 maxIterations = 5，经验值：2-3 次工具调用通常足够，5 次是上限。

---

### Q25：Function Calling 是什么？

**参考答案：**

Function Calling 是大模型的一种能力，允许 AI 在对话中调用预定义的外部函数。

与传统 prompt engineering 的区别：
- **Prompt engineering**：用自然语言告诉 AI "如果需要天气信息，就说'我需要查天气'"，然后通过正则匹配来触发工具。AI 可能忘记触发或格式不对。
- **Function Calling**：在 API 请求中用 JSON schema 定义工具，AI 返回结构化的 `tool_calls` 字段。这是 AI 原生支持的能力，更可靠。

示例：
```
// 请求中定义工具
tools: [{name: 'get_weather', parameters: {city: {type: 'string'}}, ...}]

// AI 返回
{choices: [{message: {
  role: 'assistant',
  tool_calls: [{id: 'xxx', function: {name: 'get_weather', arguments: '{"city":"北京"}'}}]
}}]}
```

AI 不需要被 prompt，会自动根据用户问题决定是否调用、调用哪个工具、传什么参数。

---

### Q26：工具是怎么注册的？

**参考答案：**

在 `services/tools/registerTools.ts` 中用一个简单的注册表模式：

```
const tools: ToolRegistry[] = [
  {
    name: 'get_weather',
    description: '获取指定城市的天气信息',
    schema: { city: { type: 'string', description: '城市名' }, date: { type: 'string' } },
    execute: async (args) => { /* 实现逻辑 */ }
  },
  {
    name: 'search_documents',
    description: '在知识库中检索相关文档',
    schema: { query: { type: 'string' }, topK: { type: 'number' } },
    execute: async (args) => { /* 调用 RAG 检索 */ }
  },
  {
    name: 'list_sessions',
    description: '列出当前用户的会话列表',
    schema: { limit: { type: 'number' } },
    execute: async (args) => { /* 查 sessions 表 */ }
  },
  {
    name: 'get_current_time',
    description: '获取当前时间',
    schema: { timezone: { type: 'string' } },
    execute: async (args) => new Date().toISOString()
  },
]
```

每个工具包含 name（唯一标识）、description（AI 用来理解工具用途）、schema（参数定义）、execute（执行函数）。

---

### Q27：工具调用的完整执行流程？

**参考答案：**

```
① AI 分析用户意图 → 返回 tool_calls
   { tool_calls: [{ function: { name: 'get_weather', arguments: '{"city":"北京"}' } }] }

② BFF 检测到 tool_calls → 解析
   const toolName = 'get_weather'
   const args = { city: '北京' }

③ 从注册表查找工具
   const tool = tools.find(t => t.name === toolName)

④ 执行工具
   const result = await tool.execute(args)

⑤ 把结果回传给 AI
   messages.push({ role: 'tool', tool_call_id: 'xxx', content: JSON.stringify(result) })

⑥ AI 基于工具结果继续推理
   - 如果结果足够回答 → 生成最终回复
   - 如果还需要更多信息 → 继续调用其他工具
   - 陷入循环 → 超过 maxIterations 强制结束
```

SSE 事件流：在步骤④执行工具时推 on_tool_start，⑤完成后推 on_tool_end，⑥生成回答时推 on_chain_stream。

---

### Q28：如果工具执行失败怎么办？

**参考答案：**

工具执行失败的处理：
1. **捕获错误**：`tool.execute(args)` 外面包 try-catch
2. **把错误作为结果回传给 AI**：
   ```
   messages.push({ role: 'tool', content: JSON.stringify({ error: 'City not found' }) })
   ```
3. **AI 基于错误信息继续推理**：
   - AI 看到错误后，可能换个工具（比如改用 search_documents）
   - 或者告知用户"该城市暂无天气数据"
   - 不会直接崩溃

4. **如果 AI 连续调用失败**：maxIterations 限制兜底，强制结束

这样设计的好处是：错误处理在 AI 层面，AI 有机会做 fallback，而不是直接把错误抛给用户。

---

## 第五部分：前端实现（Q29-Q33）

### Q29：前端的 Composables 模式是什么？

**参考答案：**

在 Vue 3 中，Composables 是可复用的逻辑封装单元。每个 composable 封装一个领域的状态和方法：

- **useChat**：管理会话列表、当前会话、发送消息、SSE 流式接收
- **useRag**：文档上传/列表/删除、RAG 查询（流式+非流式）
- **useTools**：工具列表加载、工具执行
- **useAgent**：Agent 运行、暂停、恢复、回滚、SSE 事件处理

模式特点：
1. 内部维护 ref 状态（documents、isLoading、error 等）
2. 暴露方法（loadDocuments、uploadDocument 等）
3. 方法内部调用 BFF API
4. 组件中通过 `const { documents, uploadDocument } = useRag()` 解构使用

React 端用自定义 Hook 实现相同的模式，逻辑完全一致。

---

### Q30：前端怎么处理 SSE 流？

**参考答案：**

核心解析逻辑：

```
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...payload, stream: true }),
})

const reader = response.body.getReader()
const decoder = new TextDecoder()
let buffer = ''

while (true) {
  const { value, done } = await reader.read()
  if (done) break

  const chunk = decoder.decode(value, { stream: true })
  buffer += chunk

  // SSE 用 \n 分割事件
  const lines = buffer.split('\n')
  buffer = lines.pop()  // 保留不完整的行

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data: ')) continue

    const data = trimmed.slice(6).trim()
    if (data === '[DONE]') continue

    const event = JSON.parse(data)
    handleEvent(event)
  }
}
```

关键点：
- `\n` 分割事件（不是 `\r\n`，需要 trim 兼容）
- `buffer` 累积处理不完整的行
- `data: ` 前缀提取 JSON 数据
- `[DONE]` 标识流结束
- `TextDecoder` 用 stream 模式正确处理 UTF-8

---

### Q31：会话数据存在哪里？

**参考答案：**

会话数据存在 **localStorage**，key 为 `ai-generator-sessions`。

选择 localStorage 的原因：
1. **学习项目**：不需要多设备同步
2. **离线可用**：刷新页面后会话不丢失
3. **实现简单**：不需要后端额外的会话管理 API
4. **即时持久化**：每次更新会话后立即写入 localStorage

localStorage 的数据结构：
```
{
  id: 'timestamp-random',
  title: '新对话',
  messages: [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }],
  createdAt: 1714000000000,
  updatedAt: 1714000000000
}
```

切换会话通过 `activeSessionId` 记录当前选中的会话 ID。

如果要升级到服务端存储，可以用已有的 sessions 表和 messages 表，BFF 已经实现了 `/api/sessions` 系列接口。

---

### Q32：Vite 代理是怎么配置的？

**参考答案：**

在 `vite.config.ts` 中配置开发代理：

```
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
```

作用：前端开发时，所有 `/api/*` 的请求自动转发到 BFF 的 3001 端口。这样前端代码中可以直接写 `fetch('/api/chat/completions')`，不需要关心 BFF 地址。

生产环境：前端直接部署在 Nginx，配置反向代理把 `/api` 路径转发到 BFF 服务器。

CORS 处理：开发环境通过代理绕过 CORS；如果直接跨域请求，BFF 需要配置 `cors()` 中间件允许前端域名。

---

### Q33：两套前端的 API 调用逻辑一样吗？

**参考答案：**

是的，两套前端的 API 调用逻辑完全一致：
- 都通过 `useRuntimeConfig().public.bffUrl` 获取 BFF 地址
- 都使用 `packages/shared` 中定义的类型
- Composables/Hooks 的 API 签名一致

差异只在 UI 渲染层：
- React 端用 `useState`、`useEffect`、JSX
- Vue 端用 `ref`、`computed`、模板语法
- Tailwind CSS 类名、组件写法略有不同

这样的好处是：后端或 shared 包改了，两套前端同步更新，不会出现不一致。

---

## 第六部分：工程与调试（Q34-Q38）

### Q34：项目开发过程中遇到的最大 bug 是什么？

**参考答案：**

**SSE 解析 Bug**：前端流式接收 AI 响应时，经常出现回答内容丢失或 JSON 解析失败。

排查过程：
1. 现象：流式回复的后半段丢失，或者直接报错
2. 初步怀疑：网络问题？AI API 不稳定？
3. 实际原因：**chunk 边界处理不当**

具体问题：
- 问题1：用 `chunk.split('\n')` 分割事件，但 Windows 环境下 BFF 用 `\r\n` 结尾，导致解析出空行或异常行
- 问题2：buffer 累积时，直接丢弃了最后一行（可能是不完整的 JSON）
- 问题3：有些空行（比如 SSE 的心跳 `: ping`）被当作数据行处理

修复方案：
```
const lines = buffer.split('\n')
buffer = lines.pop() || ''  // 保留不完整的行
for (const line of lines) {
  const trimmed = line.trim()  // 处理 \r\n
  if (!trimmed || !trimmed.startsWith('data: ')) continue  // 跳过空行和心跳
  const data = trimmed.slice(6).trim()
  if (data === '[DONE]') continue
  try { JSON.parse(data) } catch {}  // 容错：单条解析失败不影响其他
}
```

经验教训：SSE 协议看起来简单，但边界情况多，必须仔细处理。

---

### Q35：SSE 解析修过哪些 bug？

**参考答案：**

总共修过 4 个 bug：

1. **空行未跳过**：SSE 规范中事件之间有空行，初始代码没跳过空行，导致解析出空的 JSON。修复：加 `if (!trimmed) continue`。

2. **`\r\n` 处理**：BFF 在 Windows 上开发时，`res.write()` 默认用 `\r\n` 结尾。前端用 `split('\n')` 分割后，每行末尾带 `\r`。修复：加 `.trim()` 去掉 `\r`。

3. **不完整行处理**：当一个 chunk 刚好在事件中间切断时（比如 JSON 写到一半），直接丢弃会丢失数据。修复：用 `buffer` 累积，`lines.pop()` 保留不完整的行，和下一个 chunk 拼接后再处理。

4. **JSON parse 异常**：偶尔 AI 返回的 JSON 格式不规范，直接 JSON.parse 会抛异常中断整个流。修复：加 `try { JSON.parse(data) } catch {}` 容错，单条失败不影响其他。

这些都是典型的流式数据处理边界问题。

---

### Q36：API Key 存在哪里？

**参考答案：**

API Key 只存在 BFF 的 `.env` 文件中：
```
# apps/server/.env
ZHIPU_API_KEY=sk-xxxxxxxxxxxx
PORT=3001
```

前端代码中**绝对不会出现** `sk-` 字样：
- 检查方式：在整个 web-react 和 web-vue-nuxt 目录 grep `sk-`，应该零匹配
- 前端只知道 BFF 地址，不知道 AI 提供商的 API Key

安全设计：
1. `.env` 文件加入 `.gitignore`，不提交到仓库
2. BFF 内部从 `process.env` 读取 Key
3. 所有 AI 调用都在 BFF 内部完成，前端发请求到 BFF，BFF 用 Key 调 AI API

这是 BFF 模式的核心价值之一：保护密钥不泄露。

---

### Q37：如果让你重新设计这个项目，你会做哪些不同的选择？

**参考答案：**

1. **向量存储升级**：目前用 SQLite JSON 存 embedding，数据量大了会有性能问题。生产环境应该用 pgvector（PostgreSQL 插件）或 Milvus。
2. **多模态支持**：目前只支持文本，后续可以加图片、代码文件的解析和 embedding。
3. **Agent 可视化**：目前的 Agent 状态机只有文字展示，可以加上节点执行的可视化流程图（类似 LangSmith 的 trace 视图）。
4. **用户体系**：目前是单用户，没有登录。生产环境需要加用户认证和会话隔离。
5. **流式传输优化**：可以用 SSE + WebSocket 双通道，SSE 推增量更新，WebSocket 做双向通信（比如 Agent 暂停/恢复）。
6. **CI/CD**：目前是手动启动，后续可以加 GitHub Actions 自动构建部署。

---

### Q38：项目目前有哪些不足？

**参考答案：**

1. **无用户认证**：任何人都能访问，没有权限控制
2. **无多租户**：所有会话和文档混在一起，不支持多用户
3. **SQLite 单机**：不支持并发写入，数据量大会有锁竞争
4. **无监控告警**：没有日志聚合、性能监控、异常告警
5. **无测试**：没有单元测试和集成测试
6. **无部署文档**：只有开发模式，没有生产部署方案
7. **RAG 管道简单**：分块策略单一，没有实现重排序（Rerank）
8. **Agent 能力有限**：工具少，只有 4 个，没有实现多 Agent 协作

如果要上线，优先补：用户认证、PostgreSQL 迁移、日志监控、核心功能的单元测试。

---

## 第七部分：AI 相关基础（Q39-Q43）

### Q39：RAG 和 fine-tune 有什么区别？

**参考答案：**

| 维度 | RAG | Fine-tune |
|------|-----|-----------|
| **原理** | 检索相关文档作为上下文，让 AI 基于上下文回答 | 用训练数据调整模型参数，让模型"记住"知识 |
| **知识更新** | 实时更新，上传新文档即可 | 需要重新训练，成本高、周期长 |
| **可追溯性** | 可以返回 AI 基于哪些文档回答 | 无法追溯知识来源，AI "忘记"了 |
| **成本** | 低，只需要存储文档 | 高，需要 GPU 集群训练 |
| **幻觉控制** | 好，AI 被约束在上下文内 | 差，模型可能生成过时或错误的知识 |
| **适用场景** | 知识密集型问答、客服、文档搜索 | 风格调整、特定任务分类、语言微调 |

我的项目选 RAG 是因为：
1. 知识库内容频繁变化（用户上传新文档）
2. 需要可追溯（告诉用户 AI 基于哪些内容回答）
3. 资源有限（学习项目，没有 GPU 集群）

---

### Q40：Embedding 模型和对话模型是同一个吗？

**参考答案：**

通常是不同的模型，因为它们的职责不同：

- **Embedding 模型**：只负责把文本转换成向量，不生成文字输出。衡量标准是向量的语义表达能力。比如 bge-large-zh（1024 维）、text-embedding-3-small（1536 维）。
- **对话模型**：负责理解上下文、生成回答。衡量标准是对话质量、推理能力、指令跟随。比如 GPT-4、Claude 3、Zhipu。

分开的好处：
1. **性能优化**：Embedding 模型通常比对话模型小很多，调用成本低
2. **灵活替换**：可以单独升级 Embedding 模型而不影响对话模型
3. **专业优化**：可以选最适合中文的 Embedding 模型（bge-large-zh），同时选最好的对话模型

我的项目用 bge-large-zh 做 Embedding，用智谱 AI 做对话，两个独立的 API 调用。

---

### Q41：Token 是什么？Streaming 是按 token 推送吗？

**参考答案：**

**Token 是 AI 处理文本的最小单位**，不一定等于"一个字"或"一个词"：
- 中文：1 个字 ≈ 1-2 个 token
- 英文：1 个单词 ≈ 1-2 个 token
- 标点、空格也是 token

**Token 影响**：
- API 计费按 token 数计算
- Context window 按 token 数限制（比如 128K token）
- Embedding 模型的输入长度按 token 计算

**Streaming 确实按 token 推送**：
- AI 生成一个 token 就推一个 delta 事件
- 前端实时渲染，实现打字机效果
- 用户体验更好：不需要等 AI 生成完整回答再看到内容

示例：AI 回答"你好，世界"，可能分 4-5 个 token 推送：
```
token1: "你"
token2: "好"  
token3: "，"
token4: "世界"
token5: "" (finish)
```

---

### Q42：Context window 是什么？

**参考答案：**

Context window 是 AI 模型单次能处理的最大 token 数量，包括：
- System prompt
- 历史对话
- 新输入
- AI 生成的输出

比如 128K context window 意味着最多处理 128K token。

**超出的处理方案**：
1. **滑动窗口**：只保留最近 N 轮对话，丢弃最早的消息
2. **摘要压缩**：把历史对话总结成一段摘要，减少 token 占用
3. **RAG 检索增强**：把历史文档存到向量库，需要时检索注入，不全部塞进 context
4. **模型选择**：用更大 context window 的模型（从 4K → 128K → 1M）

我的项目用方案 3：知识库内容存在向量库中，查询时只注入检索到的 top-K 片段（而不是整个知识库），避免超出 context window。

---

### Q43：Function Calling 和 ReAct 范式是什么关系？

**参考答案：**

**ReAct（Reason + Act）** 是一种 Agent 设计范式：
- Reason：AI 先推理，分析需要什么信息
- Act：AI 执行行动（调用工具）
- 观察结果后继续推理
- 循环直到得出最终答案

**Function Calling 是实现 ReAct 的底层机制**：
- ReAct 是**设计思想**（Agent 应该先推理再行动）
- Function Calling 是**技术实现**（AI 通过结构化的 tool_calls 输出行动指令）

关系类比：
- ReAct = "Agent 应该像人一样思考和行动"（思想）
- Function Calling = "AI 通过 JSON 格式的 tool_calls 告诉程序要调用哪个函数"（实现）

我的 Agent 实现了 ReAct 范式：
```
think（推理）→ 决定调用工具 → call_tools（行动）→ observe（观察）→ think（继续推理）→ ... → answer（回答）
```

Function Calling 是其中 AI 决定"调用哪个工具、传什么参数"的技术手段。没有 Function Calling，就需要用 prompt engineering 让 AI 输出特定格式，稳定性差。

---

## 附录：面试话术速查

**30 秒项目介绍**：
> 这是一个基于大模型的 UI 组件生成工具，用户通过对话描述需求，AI 直接生成组件代码。同时支持上传文档构建知识库和 Agent 多步推理。技术栈是 Node.js + Express 做 BFF 后端，集成 LangChain 实现 RAG 和 Agent，前端用 React 和 Vue 3 双框架实现。整个项目覆盖了 AI 应用从前端展示、API 设计、AI 集成到数据存储的全链路。

**核心亮点一句话**：
> 项目最大的特点是实现了完整的 RAG 管道和 Agent 状态机，这两块是面试中最有技术含量的部分。

**遇到不会的问题怎么说**：
> "这个问题我了解一些，但我们项目中没有深入实践过。我知道主流的做法是 XXX，如果让我在项目中实现，我会从 YYY 开始尝试。"