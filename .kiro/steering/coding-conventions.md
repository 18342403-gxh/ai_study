---
inclusion: auto
---

# 编码规约

本项目适用的编码规范，基于大前端编码规约精简而来，去掉了不相关的平台规范（Flutter/Android/iOS/Taro 小程序）。

## 一、命名规范

| 类型 | 规范 | 正确示例 | 错误示例 |
|------|------|---------|---------|
| 文件名（组件） | PascalCase | `OrderDetail.tsx` | `orderDetail.tsx` |
| 文件名（工具/hooks） | camelCase | `useAuth.ts` | `UseAuth.ts` |
| 组件名 | PascalCase | `OrderDetailPage` | `orderDetailPage` |
| 函数/方法 | camelCase，动宾短语 | `fetchOrderList` | `getData` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` | `maxRetryCount` |
| 布尔变量 | is/has/should 前缀 | `isLoading` | `loading` |
| 事件处理 | handle/on 前缀 | `handleSubmit` | `submit` |

## 二、注释规范

- 所有注释使用中文
- 组件顶部必须有功能说明注释（知识点编号 + 学习要点）
- 复杂业务逻辑必须有行内注释说明意图
- 禁止无意义注释（如 `// 设置状态` 对应 `setState`）

## 三、文件组织

- 单个文件不超过 300 行（学习项目适当放宽），超过需拆分
- 导入顺序：第三方库 → 内部公共模块 → 相对路径模块 → 样式文件
- 每个导入分组之间空一行
- 禁止循环依赖

## 四、函数规范

- 单个函数不超过 50 行，超过需拆分
- 嵌套深度不超过 3 层，超过需提前返回或拆分
- 函数参数不超过 4 个，超过使用对象参数
- 函数职责单一

## 五、错误处理

- 所有网络请求必须有 try-catch 处理
- 错误信息必须对用户友好（中文提示），禁止直接展示技术错误
- 异步操作必须处理 loading/error/success 三种状态
- 组件卸载后禁止更新状态（AbortController 或 mounted ref）
- 异常捕获禁止空 catch，必须有错误状态设置

## 六、空值安全

- 变量使用前必须做非空判断
- 链式访问使用可选链（`?.`）
- 数组操作前检查是否为空或 undefined
- 禁止 TypeScript 强制类型断言（`as`），除非有充分理由并注释说明

## 七、React 组件规范

- 统一使用函数组件 + Hooks，禁止 Class 组件
- 组件 Props 必须定义 TypeScript interface，禁止 `any`
- 单个组件 Props 不超过 10 个
- 受控组件优先

## 八、Hooks 规范

- 自定义 Hook 必须以 `use` 开头
- useEffect 依赖数组必须完整
- useEffect 中有异步操作必须处理清理函数（AbortController）
- 禁止在条件语句中调用 Hooks

## 九、性能规范

- 合理使用 `React.memo` 避免不必要重渲染（纯展示组件推荐）
- `useMemo` 缓存计算结果，`useCallback` 缓存回调函数
- key 必须稳定且唯一，禁止使用数组 index 作为 key（除非列表不变）
- 禁止在 render/return 中创建新对象或新函数（移到组件外或 useMemo）
- 长列表考虑虚拟滚动

## 十、安全规范

- 禁止使用 `dangerouslySetInnerHTML`（除非已做 XSS 过滤）
- 禁止在前端硬编码密钥、token、密码（使用环境变量）
- 用户输入必须校验

## 十一、状态管理

- 局部状态用 useState，跨组件共享状态用 Redux Toolkit（@reduxjs/toolkit + react-redux）
- Store 按业务域拆分 slice（如 chatSlice、userSlice）
- 使用 configureStore 配置 store，自动集成 DevTools
- 导出类型化 hooks（useAppDispatch / useAppSelector）替代原始 hooks
- 派生数据使用 selector 或 createSelector，禁止冗余存储
- 持久化通过 store.subscribe + localStorage 实现

## 十二、调试代码清理

- 禁止提交 console.log 调试日志
- 禁止提交注释掉的大段代码
- 禁止提交调试地址（localhost 硬编码等）

## 十三、依赖管控

- 三方依赖使用精确版本（`--save-exact`），禁止 `^` 或 `~`
- 引入新依赖前需要确认必要性

## 十四、提交前自检清单

- [ ] TypeScript 编译无错误（`npm run build` 通过）
- [ ] 所有网络请求有错误处理
- [ ] 异步操作处理了 loading/error/success 状态
- [ ] 无硬编码的密钥、token
- [ ] 中文注释完整，复杂逻辑有说明
- [ ] 单个文件不超过 300 行
- [ ] 单个函数不超过 50 行
- [ ] 无调试代码残留（console.log 等）
- [ ] 事件监听/定时器在 cleanup 中移除
- [ ] 变量使用前已做非空判断
