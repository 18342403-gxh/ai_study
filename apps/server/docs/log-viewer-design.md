# 浏览器日志查看器 技术方案

## 1. 需求理解
- 用户想在浏览器里看后端日志，不用看终端
- 能看日志级别（INFO/WARN/ERROR）、请求路径、状态码、耗时
- 实时刷新 + 级别过滤 + 搜索

## 2. 技术选型
| 选项 | 选择 | 理由 |
|------|------|------|
| 前端形式 | 单文件 HTML + Express static | 极简，不用在 Nuxt 加页面，直接 `http://localhost:3001/api/logs-view` 访问 |
| 实时传输 | SSE（EventSource） | 已有 SSE 基础设施，EventSource API 极简 |
| 日志存储 | 内存环形缓冲区（1000 条） | 轻量，不需要数据库；超过自动淘汰最老的 |
| 日志采集 | 改 logger.ts 同时写缓冲区 | 复用现有 requestLogger，不新增中间件 |

## 3. 架构设计

```
请求 → requestLogger → [stdout] + [环形缓冲区]
                                    ↓
                       ┌──── GET /api/logs（历史 + 过滤）
                       ├── GET /api/logs/stream（SSE 实时推送）
                       └── GET /api/logs-view（单文件 HTML）
```

### 环形缓冲区
```typescript
interface LogEntry {
  id: number
  time: string        // ISO
  level: 'INFO' | 'WARN' | 'ERROR'
  requestId: string
  method: string
  url: string
  status: number
  durationMs: number
}
```

## 4. API 契约

| 端点 | 方法 | 参数 | 响应 |
|------|------|------|------|
| `/api/logs` | GET | `?level=WARN\|ERROR&limit=100` | `LogEntry[]` |
| `/api/logs/stream` | GET | — | SSE `data: {type: 'log', entry: LogEntry}\n\n` |
| `/api/logs-view` | GET | — | 单文件 HTML 页面 |

## 5. 实现计划
1. **改造** `middleware/logger.ts` — 加入环形缓冲区 `LogRingBuffer`，requestLogger 同时 push
2. **新增** `routes/logs.ts` — `/api/logs` 历史 + `/api/logs/stream` SSE
3. **新增** `public/logs-view.html` — 单文件 HTML，EventSource 实时流
4. **注册** 在 `index.ts` 挂路由
5. **安全** circuitBreaker 的 AI_ROUTE_PATHS 不匹配 `/api/logs*`

## 6. 风险与约束
- 内存存储，进程重启丢失（可接受）
- SSE 流必须跳过 circuitBreaker（已确认不匹配）
- 缓冲区 1000 条够用，超过自动淘汰最老的
