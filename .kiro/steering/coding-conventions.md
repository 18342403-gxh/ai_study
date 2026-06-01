# 编码规范

## TypeScript 规则

- 所有文件使用 TypeScript，禁止 `any` 类型
- 接口用 `interface`，联合类型用 `type`
- 组件 Props 使用 `interface XxxProps {}`
- 导出类型时使用 `export type` 或 `export interface`

## React 组件规范

- 函数组件使用箭头函数：`const Xxx: React.FC<Props> = () => {}`
- Hook 命名以 `use` 开头：`useChat`、`useStreaming`
- 组件文件名使用 PascalCase：`MessageBubble.tsx`
- Hook/工具文件名使用 camelCase：`useChat.ts`、`parseSSE.ts`

## 状态管理

- 组件内部状态：`useState` / `useReducer`
- 跨组件共享状态：zustand store
- 服务端数据：自定义 Hook 封装 fetch 逻辑
- 避免 prop drilling 超过 2 层

## 代码组织原则

- 每个模块自包含，模块间不互相 import（公共代码放 `components/` 或 `services/`）
- 每个文件职责单一，不超过 200 行
- Hook 只封装逻辑，不包含 UI
- 类型定义集中在 `types.ts`

## 注释规范

- 每个知识点对应的代码文件顶部添加注释说明该知识点
- 关键逻辑处添加中文注释，解释「为什么这样做」
- 面试相关的代码段用 `// 📝 面试考点：xxx` 标注

```typescript
// 📝 面试考点：AbortController 实现请求超时
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 10000)
```

## 错误处理

- API 调用必须 try-catch
- 错误信息对用户友好（中文提示）
- 网络错误和业务错误分开处理
- 组件级错误使用 Error Boundary（可选）
