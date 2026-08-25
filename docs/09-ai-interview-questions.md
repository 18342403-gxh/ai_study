# AI 产品前端面试题专项文档

> **文档目标**：汇总 AI 产品工程师高频面试题，全部基于 AI 真实业务场景，避免通用八股文。

---

## 说明：面试题设计原则

1. **AI 场景题 ≥ 80%**：每道题都绑定 AI 业务场景（SSE 流式、多轮对话、Function Calling、RAG、Agent 等），拒绝"闭包有哪些场景？"这类通用题。
2. **通用题套入 AI 业务**：将前端基础知识（闭包、事件循环、虚拟滚动、SSR 等）嵌入 AI 产品语境，例如"闭包在 SSE 流式累加、AbortController 清理、Pinia 持久化、useChat 中的 4 个 AI 场景应用"。
3. **答案要点导向**：每题给出 3-5 个关键答案要点，面试官可据此判断候选人的知识深度。
4. **评分分级**：初级（知道 API 调用）→ 中级（理解原理并能处理边界情况）→ 高级（能设计架构并预判坑点）。

---

## 一、流式响应模块（10 题）

### 1. SSE 粘包处理

**问题**：在 AI 对话场景中，后端通过 SSE 推送 token，前端用 `EventSource` 接收时偶尔出现"粘包"——多个 chunk 粘在一起导致 Markdown 渲染错乱。请解释原因并给出你的处理方案。

**答案要点**：
- TCP 层粘包/拆包：SSE 基于 HTTP/1.1 长连接，TCP 是流式协议，不保证消息边界
- SSE 协议本身用 `\n\n` 分隔事件、`data:` 前缀标记数据帧，但浏览器 `EventSource` API 已帮你处理了协议层分割
- 粘包实际发生在**业务层**：后端一次 `res.write()` 写入多个 token，或 Nagle 算法合并小包
- 处理方案：前端按 `data:` 行解析，以 `\n\n` 切分事件；每个 `data:` 行以 JSON 解析，`delta` 字段增量追加
- 进阶：自己实现 `fetch` + `ReadableStream` 替代 `EventSource`，手动控制解析逻辑

**评分参考**：
- 初级：知道用 `EventSource`，遇到粘包只会调后端
- 中级：理解 TCP 粘包原理，能手写 `ReadableStream` 解析器
- 高级：设计二进制协议（如 NDJSON / 自定义帧头）彻底规避粘包

---

### 2. 打字机效果卡顿

**问题**：AI 打字机输出时，用户反馈"偶尔一个字蹦不出来，等几秒突然冒一大段"。请从事件循环和浏览器渲染角度分析根因并给出优化方案。

**答案要点**：
- 根因 1：JS 主线程阻塞。如果你的 chunk 处理逻辑中同步操作过重（如 Markdown 全量解析），会阻塞 `requestAnimationFrame` 绘制
- 根因 2：浏览器后台标签节流。`requestAnimationFrame` 和 `setTimeout` 在后台被降频到 1次/分钟
- 根因 3：`EventSource` 的 `message` 事件合并。浏览器可能合并多个小 chunk 为一次事件回调
- 优化方案：用 `requestAnimationFrame` 节流渲染（每帧最多渲染 N 个 token）；后台标签检测（`document.visibilityState`）暂停或缓冲；增量渲染而非全量 Markdown 解析
- 进阶：用 `Web Worker` 做 Markdown 解析，主线程只负责 DOM 更新

**评分参考**：
- 初级：用 `setTimeout` 模拟打字机，没考虑真实流式场景
- 中级：能说清事件循环/渲染流水线关系，用 `rAF` 节流
- 高级：设计 Worker + 主线程双线程架构，处理后台节流、低电量模式等边缘场景

---

### 3. SSE 断网重连

**问题**：AI 对话时网络波动导致 SSE 断开，如何实现优雅的自动重连？请描述你的指数退避策略。

**答案要点**：
- `EventSource` 原生支持自动重连，但默认间隔 3 秒，且不知道"对话是否已结束"
- 自定义重连：监听 `onerror`，关闭旧连接，重新 `new EventSource` 并用 `Last-Event-ID` 头告知后端从断点续推
- 指数退避：初始 1s，每次 ×2，上限 30s；加随机抖动（jitter）避免惊群效应
- 状态同步：重连后立即发送"当前对话已接收的 token 数"给后端，从断点继续
- 用户体验：重连期间显示"正在重连…"提示，超时（如 30s）后提示用户手动重试

**评分参考**：
- 初级：只会 `new EventSource(url)` 重连，无退避
- 中级：实现指数退避 + Last-Event-ID 续传
- 高级：设计完整的连接状态机（connecting → open → reconnecting → closed），处理多标签页同步

---

### 4. AbortController 原理与 AI 场景应用

**问题**：用户点击"停止生成"按钮后，AbortController 如何中断 SSE 请求？如果后端已经在生成，前端中断了，后端怎么办？

**答案要点**：
- `AbortController` 通过 `signal` 传递取消信号，`fetch(signal)` 接收后立即 resolve Promise，`EventSource` 不支持 signal，需改用 `fetch` + `ReadableStream`
- 后端感知：HTTP 连接关闭时 TCP RST，Express/Koa 的 `req.on('close')` 可捕获，立即中断 LLM 调用（调用 `client.cancel()`）
- 场景延伸：多轮对话中"替换最后一条消息"也需要 abort 上一次生成；组件卸载时清理请求避免内存泄漏
- 进阶：用 `AbortSignal.timeout()` 设置超时；用 `signal.throwIfAborted()` 在 async 函数中主动检查
- 坑点：`EventSource` API 本身不支持 `AbortSignal`，需升级为 `fetch` 方案

**评分参考**：
- 初级：只会 `controller.abort()` 中断 fetch
- 中级：理解 signal 传播机制，能处理 SSE 场景的中断
- 高级：设计全局 `AbortController` 管理器，处理多请求级联取消

---

### 5. Markdown 部分渲染闪烁

**问题**：流式输出中 Markdown 部分渲染可能出现闪烁——比如 `**粗体**` 只收到 `**粗` 时先渲染为普通文字，收到 `体**` 后突然变为粗体。如何解决？

**答案要点**：
- 根因：Markdown 解析基于"当前快照"，未闭合的语法（如未配对的 `**`、````）会导致渲染突变
- 方案 1：缓存未闭合的行，等 chunk 到达后补全再渲染；对"不完整"的 Markdown 行做占位处理
- 方案 2：用支持增量解析的 Markdown 库（如 `@codemirror/lang-markdown` 的 partial parse，或 `markdown-it` 的 `preprocess` 钩子）
- 方案 3：自定义渲染策略——检测到未闭合的代码块/链接/加粗标记时，保持上一个稳定渲染快照
- 进阶：用 AST diff 算法，只更新变化的 DOM 节点，而非全量 re-render

**评分参考**：
- 初级：不知道有闪烁问题
- 中级：能识别问题，用简单的"延迟渲染未闭合行"解决
- 高级：实现增量 Markdown 解析器，支持 AST diff 级别更新

---

### 6. ReadableStream vs WebSocket 选择

**问题**：AI 对话场景中，SSE（基于 ReadableStream 的 HTTP 长连接）和 WebSocket 都能实现流式推送，如何选择？

**答案要点**：
- SSE 优势：基于 HTTP，无需升级协议，穿透防火墙/代理容易，服务端实现简单（`res.write` 即可），自动重连
- WebSocket 优势：双向通信，适合需要客户端主动推送的场景（如实时协作、语音对话）
- AI 场景选择：纯文本/图片流式生成 → SSE；需要客户端实时控制（暂停/续传/心跳）→ SSE + Fetch；需要双向语音/视频 → WebSocket
- 实际案例：ChatGPT 用 SSE（`text/event-stream`）；实时协作白板用 WebSocket
- 坑点：SSE 单向，如需客户端回传数据（如"点赞"某条回复），需要另开 HTTP 请求

**评分参考**：
- 初级：分不清两者协议
- 中级：能从协议、代理穿透、实现成本多角度对比
- 高级：结合具体 AI 场景给出架构级决策，考虑安全/CORS/CDN 缓存策略

---

### 7. 流式渲染性能优化

**问题**：AI 回复可能非常长（几千字），流式渲染时 DOM 节点不断增多，如何保证不卡顿？

**答案要点**：
- 虚拟滚动：对消息列表使用虚拟滚动（如 `vue-virtual-scroller`），只渲染可视区域
- 节流渲染：`requestAnimationFrame` 每帧最多渲染 1 次，chunk 积累到一定量再更新 DOM
- 增量更新：不用 `v-html` 全量替换，改用 `document.createRange()` 或 `TextRange` 增量插入文本
- 懒加载：代码块、图片、表格等重元素在离开视口后懒加载
- 进阶：用 `IntersectionObserver` 做可见性检测，不可见区域降级为纯文本占位

**评分参考**：
- 初级：直接 `v-html` 全量渲染，遇到长文本卡死
- 中级：用 `rAF` 节流 + 增量 DOM 操作
- 高级：虚拟滚动 + 增量解析 + Worker 计算的完整方案

---

### 8. 光标动画实现方案

**问题**：AI 打字机输出时，末尾有一个闪烁的光标（cursor），请描述你在 Vue3/Nuxt3 中的实现方案。

**答案要点**：
- 方案 1：CSS `::after` 伪元素 + `animation: blink` 实现闪烁，配合内容尾部 `<span class="cursor">`
- 方案 2：在消息容器末尾追加一个空 `<span>`，用 CSS 动画（`opacity` 0→1→0）模拟光标
- 方案 3：流式传输期间显示光标，流结束后隐藏（用 `v-if="isStreaming"` 控制）
- Vue3 实现：用 `ref` 跟踪 `isStreaming` 状态，`watch` 消息内容变化时确保光标在末尾
- 坑点：Markdown 渲染后光标位置错位（如代码块内不应有光标），需要动态定位到最后一个文本节点之后

**评分参考**：
- 初级：用 `setTimeout` 手动操作 DOM 控制光标
- 中级：用 CSS 伪元素 + Vue 响应式控制显示/隐藏
- 高级：处理 Markdown 渲染后光标自动定位、代码块内光标隐藏等边界情况

---

### 9. SSE 心跳机制设计

**问题**：AI 对话可能持续几分钟，TCP 连接空闲时可能被中间层（Nginx/CDN）断开，如何设计心跳保活？

**答案要点**：
- 心跳消息：服务端定期（如每 15s）发送一个 `: ping\n\n`（SSE 注释行，浏览器 EventSource 会忽略）
- 客户端检测：收到 `ping` 重置超时计时器，连续 N 次（如 3 次）未收到则主动重连
- 超时计算：`心跳间隔 × (最大重试次数 + 1)` 计算总超时时间
- Nuxt/Vue3 实现：在 `useChat` composable 中维护 `lastPingTime`，用 `setInterval` 检测超时
- 进阶：用 SSE 的 `retry:` 字段告诉浏览器重连间隔；或用 `ReadableStream.getReader()` 手动实现心跳检测

**评分参考**：
- 初级：不知道需要心跳
- 中级：能实现定时检测 + 重连
- 高级：设计自适应心跳间隔（根据 RTT 动态调整），处理 CDN/Nginx 多层超时

---

### 10. 流式错误处理策略

**问题**：AI 流式输出过程中可能出现哪些错误？请描述你的错误分类处理策略。

**答案要点**：
- 错误分类：网络错误（断网/超时）、协议错误（SSE 格式错误）、业务错误（Rate Limit/内容违规/模型超载）、服务端错误（5xx）
- 降级策略：网络错误 → 指数退避重连；协议错误 → 跳过该 chunk 继续；业务错误 → 展示友好提示 + 重试按钮；服务端错误 → 切备用模型
- 用户感知：错误时不显示空白，显示"⚠️ 生成中断，点击重试"；保留已接收的部分内容
- 日志上报：每类错误上报到不同的监控渠道（Sentry/自研日志），区分严重程度
- 进阶：用状态机（FSM）管理流式生命周期：`idle → connecting → streaming → (error | done)`

**评分参考**：
- 初级：只会 `catch(err)` 打日志
- 中级：分类处理 + 降级策略 + 用户感知
- 高级：FSM 架构 + 自动故障转移 + 完善的可观测性

---

## 二、多轮对话模块（10 题）

### 11. 10 万条聊天列表性能优化

**问题**：一个 AI 聊天产品要支持用户保存 10 万条历史消息并流畅滚动，你如何优化？

**答案要点**：
- 虚拟滚动：核心方案，只渲染可视区域的 DOM（如 `vue-virtual-scroller`、`@tanstack/react-virtual`）
- 数据分页：前端按需分页加载（每次加载 100 条），滚动到底部时加载更多（infinite scroll）
- 内存管理：已加载的历史消息超过阈值时，保留最近 N 条，早期数据卸载
- 图片懒加载：`loading="lazy"` + IntersectionObserver
- 进阶：用 `IndexedDB` 存储历史消息，支持离线访问；用 `Web Worker` 做消息序列化/反序列化

**评分参考**：
- 初级：直接渲染所有消息，卡到死
- 中级：实现虚拟滚动 + 分页加载
- 高级：虚拟滚动 + IndexedDB 持久化 + Worker 处理大数据量

---

### 12. Token 压缩策略

**问题**：多轮对话中，历史消息过多会超出 LLM 上下文窗口，如何压缩？请对比滑动窗口和摘要两种策略。

**答案要点**：
- 滑动窗口：保留最近 N 轮对话（如最近 10 轮），丢弃更早的消息。实现简单，但丢失早期上下文
- 摘要策略：用 LLM 自身对历史消息生成摘要（"以下是之前对话的摘要：..."），保留摘要 + 最近几轮。保留更多上下文，但增加一次 LLM 调用
- 混合策略：最近 3 轮完整保留 + 中间消息用摘要 + 更早的丢弃
- Token 预算管理：根据模型上下文窗口动态分配（如 128K 窗口，摘要占 20K，最近对话占 10K，系统提示占 2K，剩余预留给回复）
- 前端配合：在对话 UI 中展示"AI 记忆摘要"标签，告知用户历史已被压缩

**评分参考**：
- 初级：不知道有上下文长度限制
- 中级：理解滑动窗口和摘要的 trade-off，能实现其中一种
- 高级：设计混合策略 + Token 预算管理器 + 用户可配置的压缩粒度

---

### 13. SSR 下 Hydration Mismatch 的 5 种场景

**问题**：Nuxt3 SSR 渲染 AI 聊天页面时，客户端 Hydration 出现不匹配。请列举至少 5 种可能原因。

**答案要点**：
1. **时间相关渲染**：`new Date()` 在服务端和客户端生成不同时间字符串
2. **随机数**：`Math.random()` 在服务端和客户端生成不同值
3. **浏览器 API**：使用了 `window`/`document`/`localStorage` 等，服务端渲染时为 `undefined`，客户端有值
4. **动态导入/异步组件**：服务端渲染时组件数据未就绪，客户端 Hydration 时数据已更新
5. **国际化**：服务端用默认语言，客户端检测到浏览器语言后切换
6. **AI 特有场景**：SSE 流式消息在服务端为空，客户端 Hydration 时已收到部分内容
7. **Tailwind/JIT**：服务端和客户端生成的 CSS class 顺序不同
8. **V-if 条件渲染**：依赖 `onMounted` 才设置的状态

**评分参考**：
- 初级：不知道什么是 Hydration Mismatch
- 中级：能说出 3-4 种常见原因
- 高级：结合 AI 场景（SSE 流式、用户状态依赖）说出 5+ 种并给出修复方案

---

### 14. 会话历史持久化方案对比

**问题**：AI 聊天产品的会话历史需要持久化，你会选择哪种方案？对比 localStorage、IndexedDB、Cookie、服务端存储。

**答案要点**：
- localStorage：简单，5MB 限制，同步 API，适合少量数据（如最近几条对话的 JSON）
- IndexedDB：异步 API，支持 GB 级存储，支持索引查询，适合大量对话历史（10 万条级别）+ 离线访问
- Cookie：4KB 限制，每次请求自动携带，不适合存大量数据，但适合存 Session Token
- 服务端存储：数据安全，多端同步，需要后端 API 支持，依赖网络
- AI 产品推荐：IndexedDB 存全量历史（离线可用）+ localStorage 存最近会话 ID + 服务端存完整数据（多端同步）

**评分参考**：
- 初级：只用 localStorage，遇到容量问题不知道怎么办
- 中级：理解各方案的优缺点，能选 IndexedDB
- 高级：设计 IndexedDB + 服务端同步的双写策略，处理冲突合并

---

### 15. 多会话切换状态管理

**问题**：用户同时开了 5 个 AI 对话窗口，在不同会话间切换时如何保证状态不混乱？（每个会话有自己的流式状态、Token 使用、工具调用状态）

**答案要点**：
- 每个会话独立 store：用 Pinia 的 `setup` store 模式，每个会话 ID 创建独立实例
- Tab 隔离：用 `sessionStorage` 存储当前 Tab 的会话列表，多 Tab 互不干扰
- 全局状态：用户信息、全局配置等放全局 store；会话相关的（消息、流式状态、AbortController）放会话级 store
- 切换时的状态保留：`keep-alive` 缓存组件；或用 `defineAsyncComponent` + 缓存策略
- 流式状态隔离：每个会话独立的 `AbortController`，切换会话时不中断其他会话的生成

**评分参考**：
- 初级：用单一 store，切换时数据混乱
- 中级：实现会话级 store 隔离
- 高级：设计完整的状态分层架构，处理 keep-alive + 流式重连 + 多 Tab 同步

---

### 16. 消息流式拼接的竞态条件

**问题**：用户在 AI 还在生成时点击"重新生成"或"编辑上一条消息"，可能导致新消息和旧消息的 chunk 交错拼接。如何解决？

**答案要点**：
- 竞态原因：多个 SSE 请求同时写入同一个消息对象，chunk 来自不同的生成任务
- 方案 1：Token 级去重——每个 chunk 带递增序号，前端只接受序号匹配当前请求的 chunk
- 方案 2：单飞（single-flight）模式——同一时刻只允许一个生成请求，新请求发起时 abort 旧请求
- 方案 3：消息 ID 绑定——每个生成任务有唯一 ID，chunk 携带任务 ID，前端按 ID 路由到对应消息
- Vue3 实现：用 `ref` 存储当前 `generatingId`，chunk 处理时检查 `chunk.taskId === generatingId` 才追加

**评分参考**：
- 初级：不知道有竞态问题
- 中级：实现单飞模式 + AbortController
- 高级：设计 ID 路由 + 序号校验 + 回退重放的完整方案

---

### 17. Markdown 渲染 XSS 防护

**问题**：AI 回复中可能包含恶意 Markdown（如 `<script>` 标签、`javascript:` 链接），如何防护？

**答案要点**：
- 不要用 `v-html` 直接渲染 Markdown 输出
- 用 `DOMPurify` 或 `sanitize-html` 做 HTML 清理，移除 `<script>`、`<iframe>`、`on*` 事件属性、`javascript:`/`data:` URL
- 或用 Markdown-it 的 `sanitize` 插件，在渲染阶段就过滤
- 白名单策略：只允许安全的 HTML 标签（`b`, `i`, `code`, `pre`, `img` 等）
- AI 特有风险：Prompt Injection 可能诱导 AI 输出恶意 HTML，需服务端配合做内容安全检测

**评分参考**：
- 初级：用 `v-html` 直接渲染，不知道有 XSS 风险
- 中级：使用 DOMPurify/Markdown-it 清理
- 高级：白名单策略 + 服务端内容安全检测 + CSP 头配置

---

### 18. 代码块提取与语法高亮

**问题**：AI 回复中经常包含代码块（```python ...```），如何提取代码块并做语法高亮，同时处理流式场景中代码块未闭合的情况？

**答案要点**：
- Markdown-it + highlight.js：配置 `highlight` 钩子，对 ````lang\ncode```` 格式做语法高亮
- 代码块提取：用正则或 Markdown-it 的 token 流检测代码块边界，在代码块未闭合时显示"正在生成代码…"占位
- 流式处理：代码块未闭合时，暂时将其内容渲染为纯文本（带等宽字体背景），闭合后再触发高亮
- 功能增强：每个代码块显示"复制"按钮、"在 IDE 中打开"按钮
- 进阶：用 `Shiki` 做基于 TextMate grammar 的精准高亮，支持主题切换

**评分参考**：
- 初级：用 highlight.js 做静态代码高亮
- 中级：处理流式场景中代码块的动态高亮
- 高级：Shiki + 流式增量高亮 + 代码块操作工具栏

---

### 19. 消息重试与幂等性

**问题**：AI 消息发送失败后用户点击"重试"，如何保证重试的幂等性（不会导致后端重复生成）？

**答案要点**：
- 客户端生成唯一 `messageId`（UUID），重试时携带相同的 ID
- 后端用 `messageId` 做去重（Redis SET 或数据库唯一索引）
- 前端状态管理：失败消息标记为 `failed`，重试时状态改为 `retrying`，成功后改为 `done`
- 乐观更新：重试时先在 UI 显示"重试中…"，成功后移除失败标记
- 边界处理：网络超时但后端可能已成功，重试时需先查询 `messageId` 是否已生成

**评分参考**：
- 初级：直接重新发送，不知道幂等性
- 中级：实现 messageId + 后端去重
- 高级：设计完整的重试状态机 + 超时回查 + 用户可取消

---

### 20. 长列表内存泄漏排查

**问题**：AI 聊天页面打开 2 小时后越来越卡，内存占用翻倍。请描述你的排查思路，重点关注 Vue3/Nuxt3 特有的内存泄漏点。

**答案要点**：
- 排查工具：Chrome DevTools Memory 面板 → Heap Snapshot 对比 → 找 Detached DOM Tree
- AI 产品特有泄漏点：
  1. SSE `EventSource` 未在组件卸载时 `close()`，连接残留
  2. `AbortController` 未 abort，请求持续占用内存
  3. `watch` / `watchEffect` 未停止，响应式依赖残留
  4. 消息数组无限增长（虚拟滚动未卸载历史数据）
  5. `useChat` composable 内的定时器（心跳/超时）未清理
  6. Markdown 解析库的 AST 缓存未释放
- Vue3 特有：`onUnmounted` 未清理副作用；Pinia store 数据未重置
- Nuxt3 特有：`useAsyncData` 的 `watch` 选项导致数据不释放

**评分参考**：
- 初级：用 Heap Snapshot 看表面问题
- 中级：定位到 SSE/定时器/响应式泄漏
- 高级：系统性排查 + 预防性设计（自动清理的 composable 模式）

---

## 三、Function Calling 模块（8 题）

### 21. Function Calling 完整流程

**问题**：请描述 AI 产品中 Function Calling 的完整流程，从用户提问到工具执行再到结果返回的全过程。

**答案要点**：
1. 用户输入 → 前端发送给后端（含对话历史 + System Prompt）
2. 后端调用 LLM，LLM 判断需要调用工具 → 返回 `tool_calls` 数组（含 `function.name`、`arguments` JSON）
3. 后端解析 `arguments`，校验 Schema（JSON Schema / Zod），执行对应工具函数
4. 工具执行结果（`tool_content`）追加到对话历史（`role: "tool"`）
5. 后端将完整对话历史再次发送给 LLM，LLM 基于工具结果生成自然语言回复
6. 后端将回复（含中间工具调用状态）通过 SSE 推送给前端
7. 前端渲染工具调用卡片（如"正在查询天气..."）+ 最终回复

**评分参考**：
- 初级：知道有 Function Calling，但只懂概念
- 中级：能完整描述流程，理解多轮交互
- 高级：能画出架构图，说明各环节的 Schema 设计、错误处理、超时控制

---

### 22. Schema 前端为什么不能执行

**问题**：Function Calling 中 LLM 返回了 `arguments` JSON，前端为什么不能直接执行？必须用 Schema 校验？

**答案要点**：
- LLM 返回的 `arguments` 不保证合法：可能字段缺失、类型错误、注入恶意代码
- Schema 校验的必要性：提前拦截非法参数，避免工具执行失败或安全风险
- 前端 vs 后端校验：前端可用 Zod 做预校验（提升用户体验），但后端必须用 JSON Schema 做最终校验（安全边界）
- 典型案例：LLM 返回 `{ "city": "北京; DROP TABLE users" }`，如果不校验直接拼 SQL 就会注入
- 最佳实践：前后端共享 Schema 定义（如 Zod → JSON Schema 双向转换）

**评分参考**：
- 初级：不知道 LLM 输出不可信
- 中级：理解校验的必要性，前端用 Zod 做预处理
- 高级：设计前后端共享 Schema + 类型安全的完整链路

---

### 23. 多工具调用如何防死循环

**问题**：AI 可能陷入"不断调用工具却无法生成最终回答"的死循环（如：调用 A → 结果需要 B → 调用 B → 结果需要 A）。如何防止？

**答案要点**：
- 最大工具调用次数限制：设置 `max_tool_rounds`（如 5 轮），超限后强制停止并提示用户"AI 无法自动完成，需要您介入"
- Token 预算：为工具调用设置 Token 上限，超出则停止
- 工具选择策略优化：在 System Prompt 中明确告诉 LLM"优先使用已有信息回答，而不是调用工具"
- 死循环检测：记录已调用的工具序列，如果出现重复模式（A→B→A→B），强制打断
- 人工介入：达到上限后进入 `Human-in-the-loop` 模式，让用户选择继续或放弃

**评分参考**：
- 初级：不知道会死循环
- 中级：设置最大轮次限制
- 高级：死循环检测 + 智能打断 + 优雅降级

---

### 24. 工具粒度设计原则

**问题**：设计 Function Calling 的工具时，粒度应该粗还是细？请给出你的设计原则。

**答案要点**：
- 粒度原则：**一个工具对应一个明确的原子能力**，但不要太细（LLM 难以选择）或太粗（LLM 难以控制）
- 粒度参考：
  - ❌ 太细：`get_weather()`, `get_temperature()`, `get_humidity()` 应该合并为 `get_weather(location)`
  - ❌ 太粗：`do_everything()` 什么都做，LLM 无法精确控制
  - ✅ 合适：`get_weather(location)`, `search_web(query)`, `query_database(sql)`
- 命名规范：动词开头 + 明确宾语，如 `get_stock_price(symbol)` 而非 `fetch_data(id)`
- Schema 设计：参数越少越好，每个字段有清晰的 `description`（LLM 依赖描述做选择）
- 前端配合：工具卡片的 UI 展示粒度应与工具粒度对齐

**评分参考**：
- 初级：工具命名随意
- 中级：理解粒度原则，能设计合理的工具
- 高级：结合业务场景，给出完整的工具设计规范（命名/Schema/描述/前端展示）

---

### 25. Zod 校验 vs JSON Schema

**问题**：Function Calling 的参数校验，你会选 Zod 还是 JSON Schema？为什么？

**答案要点**：
- Zod 优势：TypeScript 原生类型推导、运行时校验、链式 API、丰富的错误信息
- JSON Schema 优势：语言无关、LLM 原生理解（Function Calling 协议用的就是 JSON Schema）、生态广泛
- 实际选择：**两者结合**
  - 开发阶段：用 Zod 定义 Schema，自动推导 TypeScript 类型
  - 运行时：Zod 做前端/Node 后端校验
  - 对外暴露：用 `zod-to-json-schema` 将 Zod 转为 JSON Schema 给 LLM 看
- 注意事项：LLM 看到的 JSON Schema `description` 字段要清晰，这直接影响 LLM 的参数生成质量

**评分参考**：
- 初级：只会 JSON Schema
- 中级：理解两者差异，结合使用
- 高级：用 Zod 定义单一数据源 → 自动生成类型 + JSON Schema + 校验函数

---

### 26. 工具调用失败降级策略

**问题**：Function Calling 中某个工具调用失败了（超时、返回错误、参数非法），如何降级？

**答案要点**：
- 重试策略：幂等工具（如查询）可自动重试 1-2 次，非幂等工具（如支付）不自动重试
- 错误分类：
  - 参数错误 → 告诉 LLM"参数非法，请修正"，让 LLM 重新调用
  - 超时 → 返回部分结果或提示"服务暂时不可用"
  - 权限错误 → 提示用户需要授权
- 降级方案：工具失败后，LLM 用已有信息回答并说明限制（"抱歉，我暂时无法查询天气，但根据历史数据..."）
- 用户感知：前端展示工具调用状态（成功/失败/重试中），失败时显示错误详情

**评分参考**：
- 初级：工具失败就直接报错
- 中级：分类处理 + 重试 + LLM 自动修正
- 高级：完整的降级链路 + 用户可选的手动重试 + 错误上报

---

### 27. 工具选择策略（贪心 vs 规划）

**问题**：当有多个工具可用时，LLM 如何选择最优的工具调用序列？对比贪心策略和规划策略。

**答案要点**：
- 贪心策略：LLM 一步一步选择当前最需要的工具，简单快速，但可能不是最优路径
- 规划策略：LLM 先制定完整计划（Plan），再逐步执行（Act），复杂但更高效（Plan-and-Solve 模式）
- 实际应用：**简单场景用贪心（默认），复杂多步任务用规划**
- AI 产品实现：在 System Prompt 中引导 LLM "先思考步骤再行动"，或用 LangChain/LangGraph 的 PlanExecute Agent
- 前端配合：展示"AI 计划"让用户了解后续步骤，提高可解释性

**评分参考**：
- 初级：不知道有策略选择
- 中级：理解两种策略的 trade-off
- 高级：实现自适应策略（简单问题贪心、复杂问题规划）+ 前端可解释性展示

---

### 28. 权限控制与安全沙箱

**问题**：Function Calling 中工具可能涉及敏感操作（如发送邮件、支付、删除数据），如何做权限控制？

**答案要点**：
- 分级权限：工具分为只读（查询天气）、写入（发送邮件）、敏感（支付/删除）三级，不同等级需要不同的授权
- 前端权限卡片：敏感操作前展示确认卡片（"AI 请求发送邮件给 xxx，是否同意？"），用户确认后才执行
- 安全沙箱：工具执行在沙箱环境中运行，限制网络访问、文件系统、系统调用
- 审计日志：每次工具调用记录操作人、时间、参数、结果，便于审计
- 数据隔离：工具执行时使用最小权限原则，不传递用户不必要的数据

**评分参考**：
- 初级：所有工具都直接执行
- 中级：分级权限 + 用户确认
- 高级：完整的权限体系 + 沙箱 + 审计 + 前端可配置的权限管理面板

---

## 四、RAG 模块（8 题）

### 29. RAG 检索增强完整流程

**问题**：请描述 RAG（Retrieval-Augmented Generation）的完整流程，从用户提问到生成回复的全过程。

**答案要点**：
1. 用户提问 → Embedding 模型将问题转为向量
2. 向量数据库检索 → 找到 Top-K 最相关的文本块（chunk）
3. 重排序（可选）：用 Cross-Encoder 对 Top-K 结果重新排序
4. 拼接 Prompt：将检索到的文本块作为上下文 + 用户问题 + System Prompt 发送给 LLM
5. LLM 生成回复，回复中包含引用来源（citation）
6. 前端渲染回复 + 引用来源链接（点击可跳转到原始文档位置）
7. 用户反馈（点赞/点踩）→ 用于后续检索优化

**评分参考**：
- 初级：知道 RAG 概念，说不清流程
- 中级：能完整描述检索→增强→生成的流程
- 高级：画出架构图，说明 Embedding 选择、Top-K 策略、重排序、引用溯源等细节

---

### 30. 中文文本分块策略

**问题**：RAG 中中文文本如何分块？直接按字数切分有哪些问题？请给出更优的分块策略。

**答案要点**：
- 直接按字数切分的问题：语义断裂、句子/段落被截断、上下文丢失
- 分块策略：
  1. **按段落/标题分块**：用 Markdown 标题或空行分割，保持语义完整
  2. **递归分块**：优先按大分割符（标题）→ 中分割符（段落）→ 小分割符（句子）逐层切分
  3. **带重叠（Overlap）**：相邻 chunk 重叠 N 个 token（如 50-100），避免语义断裂
  4. **语义分块**：用 Embedding 计算句子相似度，在语义转折点切分
  5. **结构感知分块**：针对特定格式（代码/表格/FAQ）采用不同的分块策略
- 工具：LangChain 的 `RecursiveCharacterTextSplitter` 支持自定义分块字符

**评分参考**：
- 初级：按字数硬切
- 中级：理解语义分块 + overlap
- 高级：递归分块 + 语义分块 + 特定格式处理的组合策略

---

### 31. 向量数据库选型

**问题**：如果让你为一个 AI 知识库产品选择向量数据库，你会对比哪些维度？请对比 Milvus、Pinecone、Chroma、FAISS。

**答案要点**：
- 对比维度：部署方式（自建/托管）、规模（数据量/向量数）、性能（QPS/延迟）、成本、生态、易用性
- 各数据库特点：
  - **Milvus**：开源、分布式、支持亿级向量、功能完善，但运维复杂
  - **Pinecone**：全托管、Serverless、零运维，但按调用量计费、数据在第三方
  - **Chroma**：轻量级、嵌入式、适合原型开发、功能简单
  - **FAISS**：Meta 开源库、高性能、无数据库功能、需要自研上层
- 选型建议：
  - 快速原型 → Chroma
  - 生产环境（自建） → Milvus
  - 生产环境（全托管） → Pinecone
  - 超大规模（亿级+） → Milvus + FAISS 混合

**评分参考**：
- 初级：只会用 Chroma 做 Demo
- 中级：理解各数据库特点，能给出选型建议
- 高级：结合业务规模、团队能力、成本预算做系统化选型

---

### 32. 混合检索（BM25 + 向量）

**问题**：纯向量检索可能遗漏精确关键词匹配的结果，如何用混合检索（BM25 + 向量）提升召回率？

**答案要点**：
- 向量检索优势：语义相似度，理解"意思相近"
- BM25 优势：关键词精确匹配，理解"字面一致"
- 混合检索流程：
  1. 用户提问 → 同时走 BM25 检索和向量检索
  2. BM25 用关键词匹配（如"API 认证方式"精确匹配"认证"）
  3. 向量检索用语义匹配（如"怎么登录"匹配"API 认证"）
  4. 融合算法：RRF（Reciprocal Rank Fusion）或加权融合
  5. 重排序：对融合结果用 Cross-Encoder 重新排序
- 实现：Elasticsearch 支持 dense_vector + BM25 混合查询；Milvus 支持 BM25 标量过滤

**评分参考**：
- 初级：只用纯向量检索
- 中级：理解混合检索的必要性，能实现简单融合
- 高级：实现 RRF 融合 + 自适应权重 + 重排序的完整方案

---

### 33. 引用溯源实现

**问题**：RAG 回复中的引用（citation）如何实现？用户点击引用时应该展示什么？

**答案要点**：
- 引用关联：每个 chunk 存储 `source_id`（原始文档 ID）、`chunk_index`（在文档中的位置）、`page_number`（如果是 PDF）
- LLM 引用：在 Prompt 中要求 LLM 在回复中用 `[1]`、`[2]` 标记引用来源，并在返回的 `citations` 字段中列出引用的 chunk ID
- 前端渲染：将 `[1]` 转换为可点击的脚注，点击时弹出原文片段 + 跳转链接
- 引用验证：后端验证 LLM 的引用是否确实在检索结果中（防止幻觉引用）
- 用户体验：悬停时显示引用片段的 Tooltip，点击可跳转到原文位置

**评分参考**：
- 初级：引用只是简单的 URL 列表
- 中级：实现 chunk 级别的引用关联 + 前端展示
- 高级：端到端的溯源链路（文档→chunk→向量→引用）+ 幻觉引用检测 + 交互式前端

---

### 34. 知识库更新策略

**问题**：企业知识库频繁更新（新增/修改/删除文档），如何保证 RAG 检索的时效性？

**答案要点**：
- 增量更新：新文档 → 分块 → Embedding → 写入向量数据库；修改文档 → 删除旧 chunk + 写入新 chunk
- 软删除：删除文档时先标记 `is_deleted=true`，检索时过滤，定期物理删除
- Embedding 版本管理：更换 Embedding 模型时，用新版本重新索引，双版本并行一段时间后切换
- 实时性保障：监听文件系统/Webhook 触发增量更新，设置 TTL 自动过期旧数据
- 索引重建：定期（如每周）全量重建索引，清理孤立数据

**评分参考**：
- 初级：手动全量重建索引
- 中级：实现增量更新 + 软删除
- 高级：实时增量 + Embedding 版本管理 + 双写切换 + 自动化运维

---

### 35. Embedding 模型选择

**问题**：为 RAG 选择 Embedding 模型时，你会关注哪些指标？中文场景下有哪些推荐？

**答案要点**：
- 核心指标：向量维度、上下文长度、检索准确率（MTEB/C-MTEB 榜单）、推理速度、成本
- 中文场景推荐：
  - **bge-large-zh-v1.5**：开源、中文效果好、1024 维
  - **m3e-base**：腾讯开源、中文医疗/金融场景优化
  - **text-embedding-3-small**：OpenCloud 出品、多语言、1536 维、稳定
  - **doubao-embedding**：字节出品、中文效果优秀
- 选择建议：中文业务优先选中文优化模型；成本敏感选开源自部署；追求稳定选商业 API
- 向量维度影响：维度越高检索精度越高，但存储和计算成本也越高（常用 768-1536 维）

**评分参考**：
- 初级：不知道 Embedding 有多种模型
- 中级：理解核心指标，能推荐适合中文的模型
- 高级：根据业务场景（领域、语言、规模、成本）给出系统性选型

---

### 36. RAG 评估指标

**问题**：如何评估一个 RAG 系统的效果？有哪些量化指标？

**答案要点**：
- 检索阶段指标：
  - **Recall@K**：前 K 个结果中包含正确文档的比例
  - **MRR**（Mean Reciprocal Rank）：第一个正确结果排名的倒数的均值
  - **nDCG**：考虑相关性等级的排序质量
- 生成阶段指标：
  - **Faithfulness**（忠实度）：回复中有多少内容来自检索文档（vs LLM 幻觉）
  - **Relevance**（相关性）：回复对问题的回答程度
  - **Context Recall**：检索到的文档是否包含回答问题所需的信息
- 端到端指标：
  - 人工评分（1-5 分）
  - 用户反馈率（点赞/点踩）
  - 任务成功率（是否解决用户问题）
- 评估工具：RAGAS、TruLens、LLM-as-Judge

**评分参考**：
- 初级：只看用户主观感受
- 中级：理解检索和生成两个阶段的指标
- 高级：搭建自动化评估流水线 + A/B 测试 + 持续监控

---

## 五、Agent 模块（8 题）

### 37. LangGraph StateGraph 架构

**问题**：请描述 LangGraph 的 StateGraph 架构，它与简单的 ReAct Agent 有什么区别？

**答案要点**：
- StateGraph 核心：将 Agent 过程建模为**有状态的图**（节点 + 边 + 状态）
  - 节点（Node）：每个步骤（如 LLM 调用、工具执行、条件判断）
  - 边（Edge）：节点间的流转关系，支持条件分支（`conditional_edge`）
  - 状态（State）：在节点间传递的数据结构（如 `messages`, `tool_calls`, `next_step`）
- 与 ReAct 区别：
  - ReAct：线性循环（思考→行动→观察→思考...）
  - StateGraph：支持任意拓扑（分支、循环、并行、人工介入）
- 实际应用：
  - 多轮对话 Agent：`[输入→路由→检索/工具→生成→输出]`
  - 带人工审核：`[生成→人工审核→(通过→输出 / 驳回→修改)]`
  - 多 Agent 协作：`[主Agent→子AgentA/子AgentB→汇总]`

**评分参考**：
- 初级：只会 ReAct 模式
- 中级：理解 StateGraph 架构，能画出简单的图
- 高级：能用 StateGraph 设计复杂 Agent 流程，处理分支/并行/人工介入

---

### 38. Agent 时间线状态机设计

**问题**：一个 AI Agent 执行任务时可能经过多个阶段（规划→执行→反思→总结），请设计一个时间线状态机，并说明前端如何可视化。

**答案要点**：
- 状态定义：
  ```
  IDLE → PLANNING → EXECUTING → REFLECTING → SUMMARIZING → DONE
                  ↘          ↗
                   WAITING_FOR_HUMAN
  ```
- 状态转换：
  - IDLE → PLANNING：用户发起任务
  - PLANNING → EXECUTING：生成计划完成
  - EXECUTING → REFLECTING：工具调用完成
  - REFLECTING → EXECUTING：需要继续执行
  - REFLECTING → SUMMARIZING：任务完成
  - 任意状态 → WAITING_FOR_HUMAN：需要人工介入
  - 任意状态 → DONE：任务结束/失败
- 前端可视化：
  - 时间线组件（Timeline），每个节点显示状态 + 耗时 + 输入/输出摘要
  - 当前状态高亮，已完成状态折叠，失败状态标红
  - 支持暂停/恢复/回退到任意节点

**评分参考**：
- 初级：无状态机，简单线性流程
- 中级：定义状态 + 转换 + 前端展示
- 高级：完整的 FSM + 可拖拽的时间线 UI + 可回退/重试

---

### 39. Human-in-the-loop 实现

**问题**：Agent 执行过程中需要用户介入（如确认敏感操作、补充信息、审核结果），前后端如何实现？

**答案要点**：
- 触发时机：工具调用前（敏感操作确认）、信息不足时（补充提问）、结果不理想时（用户驳回）
- 实现流程：
  1. Agent 暂停执行，状态变为 `WAITING_FOR_HUMAN`
  2. 后端发送 SSE 事件 `event: "human-required"`，携带 `{task_id, question, options}`
  3. 前端渲染审核卡片（如"AI 需要确认：是否删除文件 xyz？[确认] [取消] [修改]"）
  4. 用户操作后，前端发送 `POST /api/agent/{task_id}/approve`，携带用户输入
  5. Agent 从暂停点恢复执行
- 超时处理：用户长时间未响应，可配置超时自动取消或降级

**评分参考**：
- 初级：无 Human-in-the-loop，Agent 自己跑
- 中级：实现简单的确认弹窗
- 高级：完整的暂停/恢复机制 + 超时 + 多选项 + 修改后恢复

---

### 40. Checkpointer 持久化方案

**问题**：Agent 任务可能持续数小时甚至数天（如"调研竞品并写报告"），如何持久化中间状态，支持中断恢复？

**答案要点**：
- 持久化内容：
  - 对话历史（messages）
  - 工具调用结果（中间产物）
  - 当前状态（StateGraph 的节点位置）
  - 已完成的子任务
- 存储方案：
  - **PostgreSQL**：结构化状态 + JSONB 存中间结果，支持事务和查询
  - **Redis**：热状态缓存，快速恢复
  - **文件系统/Object Storage**：大中间产物（如生成的文档）
- 恢复流程：
  1. 用户恢复任务 → 从数据库加载 StateGraph 状态
  2. 重建 LLM 上下文（对话历史 + 中间结果）
  3. 从上次暂停的节点继续执行
- LangGraph Checkpointer：内置 `MemorySaver`（内存）、`SqliteSaver`（SQLite）、`PostgresSaver`（PostgreSQL）

**评分参考**：
- 初级：任务不能中断，断了就从头来
- 中级：用数据库存状态，能恢复
- 高级：多存储分层 + 上下文重建 + 断点续执行 + 超时过期策略

---

### 41. Agent 超时保护

**问题**：Agent 执行可能因为各种原因卡住（LLM 响应慢、工具超时、死循环），如何设计超时保护机制？

**答案要点**：
- 分层超时：
  - LLM 调用超时：单次 LLM 调用 30-60s
  - 工具调用超时：单个工具 10-30s
  - 任务总超时：整个 Agent 任务 1-2h
- 超时处理：
  - LLM 超时 → 重试（换模型/降低温度）→ 失败则跳过该步骤
  - 工具超时 → 切换备用工具 / 跳过 / 降级
  - 总超时 → 强制结束，保存当前进度，生成部分结果
- 前端感知：实时显示"AI 正在思考..."，超时后提示"AI 响应较慢，是否继续等待？"
- 实现：用 `Promise.race()` + `AbortController` 做超时控制

**评分参考**：
- 初级：无超时保护，可能永久卡住
- 中级：分层超时 + 重试
- 高级：自适应超时（根据历史 RTT 动态调整）+ 优雅降级 + 用户可选

---

### 42. 多 Agent 协作模式

**问题**：复杂任务需要多个 Agent 协作（如"调研 Agent 收集信息 → 写作 Agent 撰写报告 → 审核 Agent 检查质量"），请描述你的协作模式。

**答案要点**：
- 协作模式：
  1. **顺序流水线**：A → B → C，简单线性任务
  2. **对话协作**：A 和 B 交替对话，讨论后达成共识
  3. **调度中心**：一个 Orchestrator 分配任务给多个 Agent，收集结果汇总
  4. **层级协作**：Manager Agent 规划 → Worker Agent 执行 → Manager 汇总
- 实现技术：
  - LangGraph 多 Agent：每个 Agent 是独立的 StateGraph，通过 `supervisor` 节点调度
  - 消息协议：统一的 Message 格式（`from`, `to`, `content`, `task_id`）
  - 前端展示：多 Agent 面板，每个 Agent 独立的实时状态

**评分参考**：
- 初级：单 Agent 做所有事
- 中级：实现简单的流水线模式
- 高级：设计调度中心 + 消息协议 + 可观测的多 Agent UI

---

### 43. 工具编排策略

**问题**：Agent 有 20 个可用工具，如何编排它们的使用顺序以最高效完成任务？

**答案要点**：
- 编排策略：
  1. **静态编排**：预定义工具使用顺序（如 RAG 流程：检索 → 重排序 → 生成 → 引用）
  2. **动态编排**：LLM/Agent 根据任务动态选择工具（如 ReAct 模式）
  3. **混合编排**：核心步骤预定义 + 可选步骤动态选择（如 RAG 核心流程固定，但"是否需要联网搜索"动态决定）
- 实现：
  - LangGraph：用 `add_edge`（静态）+ `add_conditional_edges`（动态）组合
  - 前端可视化：展示工具调用链路图，用户可观察/干预编排
- 优化：记录成功的工具序列作为模板，新任务优先匹配模板

**评分参考**：
- 初级：工具随机选择
- 中级：理解静态/动态编排
- 高级：混合编排 + 模板复用 + 用户可干预的编排界面

---

### 44. Agent 可观测性设计

**问题**：Agent 执行一个复杂任务后，用户和开发者如何查看 Agent 的执行过程（决策了什么、调用了什么工具、消耗了多少 Token）？

**答案要点**：
- 前端可观测性：
  - **执行时间线**：可视化每个步骤（决策 → 工具调用 → 结果）
  - **Token 消耗面板**：实时显示 Token 用量、预估成本
  - **决策路径**：展示 Agent 的思考过程（Plan）+ 实际执行路径
  - **调试模式**：开发者模式下显示完整的 LLM 输入/输出、工具参数
- 后端可观测性：
  - **结构化日志**：每个步骤记录 `{timestamp, agent_id, step, input, output, tokens, latency}`
  - **指标监控**：Prometheus + Grafana 监控成功率、平均耗时、Token 消耗
  - **Trace 链路**：OpenTelemetry 追踪从用户请求到 Agent 完成的全链路
- 用户可观测性：
  - 总结报告：任务完成后展示"AI 做了什么"的摘要
  - 成本透明：显示 Token 用量和预估费用

**评分参考**：
- 初级：只有最终结果，看不到中间过程
- 中级：展示简单的执行时间线
- 高级：前端时间线 + 后端监控 + 用户报告的完整三层可观测性

---

## 六、Vue3/Nuxt3 中高级（6 题）

### 45. Hydration Mismatch 排查清单

**问题**：Nuxt3 SSR 项目出现 Hydration Mismatch，你的排查清单是什么？

**答案要点**：
1. **数据检查**：`useAsyncData` / `useFetch` 的数据在服务端和客户端是否一致
2. **时间相关**：`new Date()`、`Date.now()` 是否在渲染时使用
3. **随机数**：`Math.random()` 是否在模板/渲染函数中使用
4. **浏览器 API**：`window`、`document`、`navigator`、`localStorage` 是否在渲染期间访问
5. **条件渲染**：`v-if` 是否依赖 `onMounted` 才设置的状态
6. **动态组件**：异步组件 / `defineAsyncComponent` 是否在两端加载时序不同
7. **Tailwind/JIT**：Tailwind CSS 类名是否在两端生成顺序不同
8. **AI 特有**：SSE 消息、WebSocket 数据是否在客户端 Hydration 后才到达
9. **国际化**：i18n 语言是否在两端不一致
10. **第三方库**：检查 UI 库是否在 SSR 下有特殊渲染逻辑

**修复工具**：`nuxt dev` 开启 Hydration 调试、`@nuxtjs/hydration` 模块、Vue DevTools 排查

---

### 46. Composable vs Pinia 状态边界

**问题**：在 AI 产品中，Composable 和 Pinia 的使用边界是什么？各适合什么场景？

**答案要点**：
- **Composable**（`useChat`, `useSSE`, `useFunctionCalling`）：
  - 封装可复用的业务逻辑（SSE 连接、AbortController 管理、消息拼接）
  - 不跨页面/组件共享状态
  - 生命周期与组件绑定（组件卸载时自动清理）
  - 适合：SSE 连接管理、打字机效果、单会话的流式状态
- **Pinia Store**（`useUserStore`, `useConversationStore`）：
  - 全局共享状态（用户信息、会话列表、全局配置）
  - 跨页面/组件访问
  - 生命周期与应用绑定（刷新页面数据不丢失）
  - 适合：用户信息、会话列表、Token 用量统计、全局设置
- **组合模式**：Composable 内部可以调用 Pinia Store（如 `useChat` 内部读写 `useConversationStore`），但 Pinia Store 不应依赖 Composable

---

### 47. SSR 安全访问浏览器 API

**问题**：Nuxt3 SSR 项目中，如何安全地访问浏览器 API（`window`、`document`、`localStorage`）而不导致 Hydration Mismatch？

**答案要点**：
- `import.meta.client` / `import.meta.server`：编译时条件分支
- `onMounted` / `onClientMounted`：生命周期钩子中访问（仅客户端执行）
- `useCookie` / `useLocalStorage`：Nuxt 内置的 SSR 安全存储方案（`useLocalStorage` 需要 `@nuxtjs/storage` 模块）
- `useAsyncData` / `useFetch`：SSR 友好的数据获取
- 动态 `import()`：按需加载仅客户端使用的库（如 Markdown 渲染库）
- `ClientOnly` 组件：包裹仅客户端渲染的内容
- AI 产品常用场景：SSE 连接（`onMounted` 中创建）、Clipboard API（复制代码块）、`document.execCommand`（富文本编辑）

---

### 48. 响应式性能优化

**问题**：AI 产品中聊天消息可能非常多（1000+ 条），Vue3 的响应式系统如何优化以保证流畅？

**答案要点**：
- 避免深层响应式：用 `shallowRef` / `shallowReactive` 代替 `ref` / `reactive`，仅追踪第一层变化
- 大数据结构优化：消息列表用 `shallowRef` 包裹，只在整体替换时触发更新；单条消息的修改用 `splice` 而非整体重新赋值
- `v-memo` 指令：稳定的子组件用 `v-memo` 跳过不必要的 re-render
- `computed` 缓存：复杂派生数据（如格式化的时间、消息摘要）用 `computed` 缓存
- `watch` 优化：用 `watchEffect` 代替 `watch` 自动追踪依赖；合理使用 `deep: true`
- 虚拟滚动配合：结合虚拟滚动只渲染可视区域，大量消息不进入 DOM

**AI 场景实例**：`useChat` 中用 `shallowRef(messages)` 存储消息数组，新增消息时用 `messages.value.push(newMsg)` 而非 `messages.value = [...messages.value, newMsg]`

---

### 49. Nuxt 插件执行顺序

**问题**：Nuxt3 中 `plugins/` 目录下的插件执行顺序是什么？AI 产品中如何保证 SSE 连接插件在 Pinia 初始化之后执行？

**答案要点**：
- 默认执行顺序：按文件名字母序执行（`01.plugin.ts` → `02.plugin.ts`）
- 自定义顺序：在文件名前加数字前缀控制（`01.pinia.ts` → `02.sse.ts`）
- `nuxtApp.hook` 钩子：用 `app.hook('app:mounted', ...)` 确保在应用挂载后执行
- `useNuxtPlugin` 的 `ssr: false` 选项：仅客户端执行
- AI 产品中的依赖关系：
  1. `01.pinia.ts`：初始化 Pinia stores（用户信息、会话列表）
  2. `02.auth.ts`：检查 Token 有效性
  3. `03.sse.ts`：建立 SSE 连接（依赖用户 Token）
  4. `04.chat.ts`：初始化默认会话（依赖 SSE 和用户信息）

---

### 50. useFetch vs useAsyncData 选择

**问题**：AI 产品中获取数据时，如何选择 `useFetch` 和 `useAsyncData`？

**答案要点**：
- `useFetch`：
  - 底层基于 `$fetch`，自动处理 SSR 数据注水
  - 自动生成 `data`、`pending`、`error`、`refresh` 响应式状态
  - 支持自动去重、缓存、延迟执行
  - 适合：简单的 API 调用（如获取用户信息、获取会话列表）
- `useAsyncData`：
  - 更底层，需要自己实现 `$fetch` 调用
  - 支持自定义 `watch` 依赖、`server` 选项
  - 适合：复杂数据获取（如需要 watch 多个依赖、需要条件执行）
- AI 场景选择：
  - 获取静态配置/列表 → `useFetch`
  - 获取对话历史（依赖会话 ID 变化）→ `useAsyncData` + `watch: () => currentSessionId`
  - SSE 流式数据 → 不用这两个，自己封装 `useSSE` composable

---

## 评分标准

### 初级工程师（0-2 年经验）

- **知识范围**：了解 API 调用，知道 SSE/Function Calling/RAG 的基本概念
- **回答深度**：
  - 流式响应：能用 `EventSource` 接收数据，知道打字机效果
  - 多轮对话：能实现基本的聊天 UI，用 Pinia 管理消息
  - Function Calling：知道有这个功能，能调用简单工具
  - RAG：听说过，知道"检索增强"的大概意思
  - Agent：听说过，知道"自动执行任务"
  - Vue3/Nuxt3：能搭建基础项目，用 `useFetch`/`useState`

**典型回答特征**：
- "SSE 就是用 `new EventSource(url)` 接收数据"
- "XSS？用 `v-html` 好像有问题，但不知道怎么解决"
- "Function Calling 就是 AI 调用 API"

### 中级工程师（2-5 年经验）

- **知识范围**：理解原理，能处理边界情况，独立完成功能开发
- **回答深度**：
  - 流式响应：能手写 `ReadableStream` 解析器，处理粘包/重连/闪烁，用 `rAF` 节流渲染
  - 多轮对话：实现虚拟滚动、Token 压缩、消息幂等性、SSR Hydration 问题排查
  - Function Calling：理解完整流程，用 Zod 做 Schema 校验，处理工具失败降级
  - RAG：能搭建完整 RAG 流程（分块→Embedding→检索→生成→引用），对比向量数据库
  - Agent：能实现 ReAct Agent，理解 StateGraph，处理 Human-in-the-loop
  - Vue3/Nuxt3：能处理 SSR 问题，合理使用 Composable 和 Pinia，响应式优化

**典型回答特征**：
- "粘包是因为 TCP 是流式协议，浏览器 EventSource 已经处理了协议层，但业务层仍可能粘包，需要按 `\n\n` 切分事件"
- "Hydration Mismatch 常见原因有 5 种：时间、随机数、浏览器 API、动态导入、AI 特有..."
- "Function Calling 的 Schema 校验前后端都要做，前端用 Zod 预处理，后端用 JSON Schema 做安全边界"

### 高级工程师（5 年以上经验 / 架构师）

- **知识范围**：设计架构，预判坑点，技术选型，团队指导
- **回答深度**：
  - 流式响应：设计 SSE/Fetch-SSE/WebSocket 混合方案，处理 CDN/代理层超时，设计完整的连接状态机
  - 多轮对话：设计亿级消息存储方案（IndexedDB + 服务端同步），多 Tab 会话隔离，智能 Token 管理
  - Function Calling：设计工具注册中心 + Schema 自动生成 + 权限沙箱，自适应工具选择策略
  - RAG：设计混合检索架构（BM25 + 向量 + 重排序），Embedding 版本管理，自动化评估流水线
  - Agent：设计多 Agent 协作架构，可观测性体系，自适应超时 + 成本控制
  - Vue3/Nuxt3：设计 SSR/CSR/SSG 混合渲染策略，Composable 规范，性能预算

**典型回答特征**：
- "流式渲染的完整架构应该是：Fetch + ReadableStream 做底层传输 → Worker 做 Markdown 解析 → rAF 节流渲染 → 虚拟滚动做 DOM 回收 → AbortController 做中断管理"
- "Hydration Mismatch 的根治方案是：保证服务端和客户端的渲染输入完全一致——通过 `useAsyncData` 确保数据同构，通过 `import.meta.client` 做客户端逻辑隔离，通过 `ClientOnly` 包裹仅客户端内容"
- "多 Agent 协作的核心是消息协议和状态共享——每个 Agent 是独立的 StateGraph，通过 Orchestrator 调度，共享的状态用全局 Store 管理，消息格式统一为 `{from, to, content, task_id, timestamp}`"

---

## 附录：AI 场景闭包应用 4 例

> 用通用前端知识点套入 AI 业务场景，体现"场景化"原则

| 场景 | 闭包作用 | 代码示例 |
|------|---------|---------|
| SSE 流式累加 | 闭包保存消息累积状态 | `useChat` 中 `messages` ref 的更新函数闭包 |
| AbortController 清理 | 闭包捕获 controller 引用 | `onMounted` 创建 controller，`onUnmounted` 闭包中 abort |
| Pinia 持久化 | 闭包存储持久化回调 | `subscribe` 回调中闭包捕获 store 状态写入 localStorage |
| useChat composable | 闭包封装 SSE 连接逻辑 | `useSSE(url)` 返回的 `connect`/`disconnect` 闭包 |

---

*本文档持续更新，新增面试题请遵循"AI 场景优先"原则*。