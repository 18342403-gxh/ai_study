<script setup lang="ts">
/**
 * 📚 知识点：教学面板 - 生成器的技术拆解
 *
 * 🤖 AI 场景价值：AI 产品的差异化竞争力
 * 不仅仅是生成代码，还能解释「为什么这样写」，帮助开发者理解背后的技术原理
 * 这是 AI 代码生成器从工具到学习平台的核心差异点
 *
 * 💡 JS 基础补充：
 * - Array.reduce() 实现 Token 计数（函数式编程风格）
 * - Promise.all() 并发请求历史与当前会话
 * - async/await 错误处理（try/catch vs .catch()）
 *
 * 💡 浏览器基础补充：
 * - SSE (Server-Sent Events) vs WebSocket：
 *   SSE 单向推送、自动重连、原生支持；WebSocket 双向通信
 *   AI 场景下 SSE 更合适（单向流式输出）
 *
 * 💡 Node 基础补充：
 * - AbortController 跨平台一致性：
 *   Node.js 18+ 内置 AbortController，与浏览器 API 兼容
 *   可用于取消 fetch、setTimeout 等
 *
 * 📱 C 端生产化改造：
 * 1. 教学内容折叠/展开，避免信息过载
 * 2. 关键知识点高亮标记
 * 3. 面试题独立标记，便于快速复习
 *
 * 🤝 与 React 对照：
 * Vue TeachingPanel ↔ React SidePanel 组件
 * Vue defineProps ↔ React props interface
 * Vue computed ↔ React useMemo
 */

import type { ChatMessage } from '@ai-study/shared'

const props = defineProps<{
  messages: ChatMessage[]
  isLoading: boolean
}>()

const activeTab = ref<'streaming' | 'conversation' | 'tools' | 'rag' | 'agent'>('streaming')

const tabs = [
  { key: 'streaming', label: '流式响应', icon: '⚡', topic: 'm2 流式响应' },
  { key: 'conversation', label: '多轮对话', icon: '💬', topic: 'm4 Chat UI' },
  { key: 'tools', label: 'Function Calling', icon: '🔧', topic: 'm5 工具调用' },
  { key: 'rag', label: 'RAG 检索', icon: '🔍', topic: 'm6 知识库' },
  { key: 'agent', label: 'Agent 编排', icon: '🤖', topic: 'm7 Agent' },
]

const currentTabInfo = computed(() => tabs.find((t) => t.key === activeTab.value)!)
const hasUserMessages = computed(() => props.messages.some((m) => m.role === 'user'))
const lastUserMessage = computed(() => {
  const msgs = props.messages.filter((m) => m.role === 'user')
  return msgs[msgs.length - 1]?.content || ''
})
const codeGenerated = computed(() =>
  props.messages.some((m) => m.role === 'assistant' && m.content.includes('```'))
)
</script>

<template>
  <div class="p-4">
    <!-- 模块 Tab -->
    <div class="flex flex-wrap gap-1.5 mb-4">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
        :class="activeTab === tab.key ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
        @click="activeTab = tab.key as 'streaming' | 'conversation' | 'tools' | 'rag' | 'agent'"
      >
        <span class="mr-1">{{ tab.icon }}</span>{{ tab.label }}
      </button>
    </div>

    <!-- 学习进度 -->
    <div class="mb-4 p-3 rounded-xl bg-gradient-card border border-brand-100">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-slate-700">{{ currentTabInfo.topic }}</span>
        <span class="text-[10px] text-brand-500">{{ currentTabInfo.label }}</span>
      </div>
      <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          class="h-full bg-gradient-primary transition-all duration-500"
          :class="{ 'animate-pulse': isLoading }"
          :style="{ width: hasUserMessages ? (codeGenerated ? '100%' : '60%') : '20%' }"
        />
      </div>
    </div>

    <!-- 教学内容 -->
    <div class="space-y-4">
      <!-- 状态提示 -->
      <div v-if="isLoading" class="p-3 rounded-xl bg-amber-50 border border-amber-200">
        <p class="text-xs text-amber-700 flex items-center gap-1.5">
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          正在生成代码... 观察 SSE 流式输出机制
        </p>
      </div>

      <div v-else-if="!hasUserMessages" class="p-3 rounded-xl bg-slate-50 border border-slate-200">
        <p class="text-xs text-slate-500">👆 在左侧输入需求开始生成组件，这里会同步显示技术拆解</p>
      </div>

      <!-- 知识点卡片 -->
      <template v-else>
        <!-- 当前需求 -->
        <div class="p-3 rounded-xl bg-blue-50 border border-blue-200">
          <p class="text-xs font-medium text-blue-700 mb-1">🎯 当前需求</p>
          <p class="text-xs text-blue-600 line-clamp-3">{{ lastUserMessage }}</p>
        </div>

        <!-- 技术拆解 -->
        <div class="p-3 rounded-xl bg-white border border-slate-200">
          <p class="text-xs font-medium text-slate-700 mb-2">📚 技术实现</p>
          <ul class="space-y-1.5 text-xs text-slate-600">
            <li class="flex gap-2">
              <span class="text-brand-500 shrink-0">•</span>
              <span>通过 BFF Server 调用 LangChain 生成代码</span>
            </li>
            <li class="flex gap-2">
              <span class="text-brand-500 shrink-0">•</span>
              <span>SSE 流式输出，实时显示生成内容</span>
            </li>
            <li class="flex gap-2">
              <span class="text-brand-500 shrink-0">•</span>
              <span>自动提取代码块，支持预览和复制</span>
            </li>
            <li class="flex gap-2">
              <span class="text-brand-500 shrink-0">•</span>
              <span>会话历史持久化，支持多轮迭代</span>
            </li>
          </ul>
        </div>

        <!-- 面试题 -->
        <div class="p-3 rounded-xl bg-purple-50 border border-purple-200">
          <p class="text-xs font-medium text-purple-700 mb-2">🧠 面试考点</p>
          <div class="space-y-2 text-xs text-purple-600">
            <p class="font-medium">Q1: SSE 流式输出如何实现打字机效果？</p>
            <p class="pl-3 text-purple-500">
              A: 使用 ReadableStream + TextDecoder 逐块解析，配合 ref 响应式更新实现逐字显示。
              关键：粘包处理（buffer.split('\\n')）、光标动画、AbortController 取消。
            </p>
            <p class="font-medium mt-2">Q2: 长对话如何处理 Token 超限？</p>
            <p class="pl-3 text-purple-500">
              A: 两种策略：① 滑动窗口（裁剪早期消息）② 摘要压缩（AI 总结历史为 system 消息）。
              压缩阈值：12 轮对话或 3000 tokens。
            </p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
