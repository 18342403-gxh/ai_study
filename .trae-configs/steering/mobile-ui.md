# 移动端 UI 规范

所有页面和组件必须以移动端 Web 为主要呈现形式。

## viewport 配置

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

## 布局规则

- 全屏布局：`h-screen flex flex-col`
- 顶部标题栏：固定 44px 高度
- 底部导航栏：固定 56px 高度，`fixed bottom-0`
- 内容区域：`flex-1 overflow-y-auto pb-14`
- 安全区域：底部加 `pb-[env(safe-area-inset-bottom)]`

## 触摸交互

- 可点击元素最小尺寸：44px × 44px
- 按钮间距 ≥ 8px
- 列表项高度 ≥ 48px
- 输入框高度 ≥ 44px

## Tailwind 移动优先写法

- 默认样式即为移动端样式，不需要 `sm:` 前缀
- 字体基础大小：`text-base`（16px）
- 内边距：`px-4`（16px 左右）
- 卡片圆角：`rounded-xl`
- 阴影：`shadow-sm`

## 聊天界面特殊规则

- 全屏对话模式（顶部标题栏 + 消息区 + 底部输入栏）
- 底部输入栏固定定位，不随内容滚动
- 键盘弹起时输入栏跟随上移（使用 `visualViewport` API 或 CSS `env(keyboard-inset-height)`）
- 消息气泡最大宽度：`max-w-[80%]`

## 颜色规范

- 背景色：`bg-gray-50`
- 用户消息气泡：`bg-blue-500 text-white`
- AI 消息气泡：`bg-white border border-gray-200`
- 主色调：`blue-500`
- 文字色：`text-gray-900`（主文字）、`text-gray-500`（辅助文字）
