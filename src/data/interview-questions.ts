export interface InterviewQuestion {
  id: string
  moduleId: number
  knowledgePointId: string
  difficulty: 'junior' | 'mid' | 'senior'
  category: 'principle' | 'coding' | 'design'
  question: string
  answerPoints: string[]
  relatedCode?: string
}

// 面试题数据按模块追加
export const interviewQuestions: InterviewQuestion[] = [
  // ===== 模块 1：AI API 基础调用 =====
  {
    id: '1.1-q1',
    moduleId: 1,
    knowledgePointId: '1.1',
    difficulty: 'junior',
    category: 'principle',
    question: '大模型 API 中 temperature 参数的作用是什么？设为 0 和 2 分别有什么效果？',
    answerPoints: [
      'temperature 控制模型输出的随机性/创造性，取值范围 0-2',
      'temperature=0 时几乎确定性输出，同样输入每次得到相同结果，适合代码生成、数据提取等需要精确一致答案的场景',
      'temperature=2 时高随机性，输出多样化但可能不连贯，适合创意写作、头脑风暴',
      '原理：temperature 作为 softmax 的除数，值越小概率分布越尖锐，值越大分布越平坦',
      '工程建议：聊天机器人用 0.7，代码补全用 0-0.2，创意写作用 1.0-1.5',
    ],
    relatedCode: 'src/modules/01-api-basics/types.ts',
  },
  {
    id: '1.3-q1',
    moduleId: 1,
    knowledgePointId: '1.3',
    difficulty: 'mid',
    category: 'coding',
    question: '如何在前端安全地管理 AI API Key？直接写在前端代码中有什么风险？',
    answerPoints: [
      '前端代码最终打包到浏览器端，用户可通过 DevTools Network 面板看到请求头中的 Key，也可从 JS 源码获取硬编码的 Key',
      '泄露后别人可用你的 Key 无限调用 API，产生巨额账单',
      '开发阶段：.env.local 存储 Key，import.meta.env.VITE_AI_API_KEY 读取，.env.local 加入 .gitignore 不入库',
      '生产阶段：前端绝不持有 Key，搭建 BFF 代理层，前端只请求自己的后端（如 /api/chat），后端在服务端添加 Key 并转发',
      '加分项：BFF 层还可做频率限制、用户身份验证、用量统计，进一步控制成本和安全',
    ],
    relatedCode: 'src/modules/01-api-basics/api.ts',
  },
  {
    id: '1.3-q2',
    moduleId: 1,
    knowledgePointId: '1.3',
    difficulty: 'mid',
    category: 'coding',
    question: 'fetch 的错误处理为什么要判断 response.ok？它和 try-catch 捕获的错误有什么区别？',
    answerPoints: [
      'fetch 的设计哲学：只有网络层面的失败才会 reject（断网、DNS 失败、CORS 拦截），HTTP 4xx/5xx 会正常 resolve',
      '只用 try-catch 不够：返回 401/500 时不会进入 catch，必须手动检查 response.ok',
      'try-catch 自动捕获的：网络断开、DNS 失败、CORS 拦截、AbortError（TypeError 类型）',
      '需要 response.ok 判断的：401 未授权、403 禁止、429 频率限制、500 服务器错误',
      '对比 axios：axios 对非 2xx 状态码自动 reject，这是 axios 和原生 fetch 错误处理的核心区别',
    ],
    relatedCode: 'src/modules/01-api-basics/api.ts',
  },
  {
    id: '1.7-q1',
    moduleId: 1,
    knowledgePointId: '1.7',
    difficulty: 'mid',
    category: 'coding',
    question: '请解释 AbortController 的工作原理，如何用它实现请求超时？',
    answerPoints: [
      'AbortController 用于中止异步操作：new AbortController() 创建实例，controller.signal 传给 fetch，调用 controller.abort() 中止请求',
      '超时实现：const timeoutId = setTimeout(() => controller.abort(), 10000)，请求完成后 clearTimeout(timeoutId)',
      '被中止的 fetch 会 reject 一个 name 为 AbortError 的错误，通过 err.name === "AbortError" 判断是超时还是其他错误',
      'React 中最佳实践：useEffect cleanup 中调用 controller.abort()，防止已卸载组件的 setState 导致内存泄漏',
      '一个 controller 只能 abort 一次，每次新请求需要创建新的 AbortController 实例',
    ],
    relatedCode: 'src/modules/01-api-basics/useChat.ts',
  },
  {
    id: '1.4-q1',
    moduleId: 1,
    knowledgePointId: '1.4',
    difficulty: 'senior',
    category: 'design',
    question: '设计一个通用的 React 异步请求 Hook，需要考虑哪些边界情况？',
    answerPoints: [
      '基础三态：loading/data/error 状态管理，请求前重置 error 和 data',
      '竞态处理：快速连续请求时，只保留最后一次的结果（用 AbortController 取消前一次，或用请求 ID 标记）',
      '组件卸载保护：useEffect cleanup 中 abort，或用 useRef 标记 mounted 状态避免 setState on unmounted',
      '重试机制：指数退避重试（retry count + delay * 2^n），429 错误根据 Retry-After 头等待',
      '缓存策略：相同参数的请求可以用 useRef 缓存结果，避免重复网络请求',
      '并发控制：限制同时发出的请求数量，防止浏览器连接池耗尽',
    ],
    relatedCode: 'src/modules/01-api-basics/useChat.ts',
  },
  // ===== 模块 2：流式响应 =====
  {
    id: '2.1-q1',
    moduleId: 2,
    knowledgePointId: '2.1',
    difficulty: 'mid',
    category: 'principle',
    question: 'SSE 和 WebSocket 有什么区别？AI 流式输出为什么选择 SSE？',
    answerPoints: [
      'SSE 是单向通信（服务端→客户端），WebSocket 是双向通信',
      'SSE 基于 HTTP 协议，天然兼容 CDN、负载均衡、代理等基础设施；WebSocket 使用独立的 ws:// 协议',
      'SSE 内建自动重连机制，WebSocket 需要手动实现重连逻辑',
      'AI 生成是单向流（模型→用户），不需要双向通信，SSE 更轻量合适',
      '服务端实现简单：只需设置 Content-Type: text/event-stream 然后逐步写入响应',
      'WebSocket 适合的场景：多人协作编辑、游戏、实时聊天室等需要双向实时通信的场景',
    ],
    relatedCode: 'src/modules/02-streaming/parseSSE.ts',
  },
  {
    id: '2.2-q1',
    moduleId: 2,
    knowledgePointId: '2.2',
    difficulty: 'senior',
    category: 'coding',
    question: '请手写一个 ReadableStream 的消费逻辑，处理流式 AI 响应',
    answerPoints: [
      'response.body.getReader() 获取 reader，new TextDecoder() 创建解码器',
      'while 循环中 await reader.read() 逐块读取，返回 { value: Uint8Array, done: boolean }',
      'decoder.decode(value, { stream: true }) 解码二进制为文本，stream:true 处理多字节字符被拆分的情况',
      '判断 done === true 时退出循环，表示流结束',
      '关键细节：不传 { stream: true } 时遇到被截断的多字节字符（如中文 UTF-8 三字节）会产生乱码',
      '异常处理：try-catch 包裹循环，AbortError 表示用户主动中断',
    ],
    relatedCode: 'src/modules/02-streaming/useStreaming.ts',
  },
  {
    id: '2.3-q1',
    moduleId: 2,
    knowledgePointId: '2.3',
    difficulty: 'mid',
    category: 'coding',
    question: 'SSE 解析中如何处理粘包和拆包问题？',
    answerPoints: [
      '粘包：一个 chunk 包含多个完整 SSE 事件；拆包：一个事件被拆到两个 chunk 中',
      '解决方案：buffer 模式 — 新 chunk 追加到 buffer，按换行符 split，lines.pop() 保留最后一个可能不完整的段',
      '最后 pop 出的如果是空字符串说明 chunk 以换行结尾（完整的），否则是被拆断的行等下个 chunk 拼接',
      '这个模式在所有流式协议解析中通用（TCP 粘包、日志 tail 等）',
      '额外注意：换行符可能是 \\n 也可能是 \\r\\n，split 时用正则 /\\r?\\n/ 兼容',
    ],
    relatedCode: 'src/modules/02-streaming/parseSSE.ts',
  },
  {
    id: '2.5-q1',
    moduleId: 2,
    knowledgePointId: '2.5',
    difficulty: 'mid',
    category: 'design',
    question: '流式渲染中如何避免性能问题？每收到一个字符就 setState 会怎样？',
    answerPoints: [
      '每次 setState 触发 re-render，500 字回复可能触发 500+ 次重渲染，导致页面卡顿',
      '方案1：useRef 累积内容 + 按 chunk 更新 state（网络 chunk 自然有一定大小，不会逐字）',
      '方案2：requestAnimationFrame 节流 — 多个 chunk 更新合并到一帧（16ms）内只执行一次 setState',
      '方案3：极致性能可直接操作 DOM（textContent），跳过 React 渲染流程，但不适合 Markdown 渲染场景',
      '实际工程中方案1已足够，因为网络 chunk 通常几十到几百字节不会真的逐字到达',
    ],
    relatedCode: 'src/modules/02-streaming/Streaming.tsx',
  },
]
