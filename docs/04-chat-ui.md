# 模块 4：聊天界面

## 学习目标

- 构建完整的聊天 UI 组件
- 实现 Markdown 渲染和代码高亮
- 处理各种消息类型（文本、代码、图片）
- 优化交互体验（自动滚动、快捷键等）

## 知识点

### 4.1 聊天界面核心组件

```
ChatContainer
├── MessageList          # 消息列表（虚拟滚动）
│   ├── UserMessage      # 用户消息气泡
│   └── AssistantMessage # AI 消息气泡
│       ├── MarkdownRenderer  # Markdown 渲染
│       └── CodeBlock         # 代码块（带高亮和复制）
├── InputArea            # 输入区域
│   ├── TextArea         # 多行输入框
│   └── ActionButtons    # 发送/停止按钮
└── Sidebar              # 会话列表（可选）
```

### 4.2 Markdown 渲染

AI 回复通常包含 Markdown 格式：
- 标题、列表、加粗
- 代码块（需要语法高亮）
- 表格
- 数学公式（可选）

推荐方案：`react-markdown` + `rehype-highlight` + `remark-gfm`

### 4.3 代码块处理

- 语法高亮（支持多种语言）
- 一键复制按钮
- 语言标签显示
- 行号显示（可选）

### 4.4 交互优化

- 自动滚动到最新消息
- Shift+Enter 换行，Enter 发送
- 输入框自适应高度
- 消息加载骨架屏
- 重新生成 / 编辑消息

## 实践任务

### 任务 1：基础聊天界面

- 实现消息列表展示（区分用户/AI）
- 输入框 + 发送按钮
- 集成模块 2 的流式输出

### 任务 2：Markdown 渲染

- 集成 react-markdown
- 添加代码块语法高亮
- 实现代码复制功能

### 任务 3：体验优化

- 自动滚动到底部
- 快捷键支持
- 消息时间戳
- 清空对话功能

### 任务 4（进阶）：会话管理

- 多会话切换
- 会话持久化（localStorage）
- 会话标题自动生成

## 参考代码结构

```
src/
├── modules/
│   └── 04-chat-ui/
│       ├── ChatPage.tsx        # 聊天页面
│       ├── MessageList.tsx     # 消息列表
│       ├── MessageBubble.tsx   # 消息气泡
│       ├── MarkdownRenderer.tsx # Markdown 渲染
│       ├── CodeBlock.tsx       # 代码块组件
│       ├── ChatInput.tsx       # 输入组件
│       └── useChatStore.ts    # 聊天状态管理
```

## 检验标准

- [ ] 完整的聊天界面，支持多轮对话
- [ ] Markdown 正确渲染，代码有语法高亮
- [ ] 流式输出时自动滚动
- [ ] 交互流畅，无明显卡顿
