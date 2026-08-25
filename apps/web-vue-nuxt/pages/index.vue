<script setup lang="ts">
/**
 * 📚 知识点：AI 组件生成器主页 - 三栏布局
 *
 * 🤖 AI 场景价值：真实 AI 产品（Cursor / CodeBuddy）的桌面端采用
 * 三栏布局：左侧导航 + 中间对话 + 右侧代码预览/教学说明
 * 这种布局让开发者在对话生成代码的同时，能实时查看代码和学习技术实现
 *
 * 💡 JS 基础补充：
 * - computed 依赖收集与响应式更新机制（Vue3 Proxy vs Vue2 Object.defineProperty）
 * - 模块化 ESM：import/export 静态分析，tree-shaking 友好
 *
 * 💡 浏览器基础补充：
 * - Flexbox 三栏布局 vs Grid 三栏布局的选择
 *   Flexbox：适合主内容流的线性布局，高度自适应
 *   Grid：适合复杂网格，但在三栏场景下 Flexbox 更简洁
 *
 * 💡 Node 基础补充：
 * - Nuxt SSR 模式下 useRuntimeConfig() 读取环境变量
 *   server 端直接读 process.env，public 字段在客户端通过 runtimeConfig.public 访问
 *
 * 📱 C 端生产化改造：
 * 1. Web 端最小宽度 1024px，低于此宽度隐藏右侧面板
 * 2. 中间对话区虚拟滚动，避免长列表性能问题
 * 3. 代码预览区支持 Monaco Editor 实时语法高亮
 *
 * 🤝 与 React 对照：
 * Vue SideNav  ↔  React Sidebar Component
 * Vue useChat() ↔  React useChat Hook
 * Vue NuxtLink ↔  React Router Link
 * Vue computed ↔  React useMemo
 */

import ChatBubble from '~/components/ChatBubble.vue'
import ChatInput from '~/components/ChatInput.vue'
import CodePreview from '~/components/CodePreview.vue'
import TeachingPanel from '~/components/TeachingPanel.vue'

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

const showCodePreview = ref(false)
const previewCode = ref('')
const previewFilename = ref('')
const rightPanel = ref<'code' | 'teaching'>('teaching')

const hasMessages = computed(() => currentMessages.value.length > 0)

const openCodePreview = (msgContent: string) => {
  const codeMatch = msgContent.match(/```[\s\S]*?```/)
  if (codeMatch) {
    const code = codeMatch[0].replace(/```\w*\n?/g, '').replace(/```$/, '')
    previewCode.value = code
    previewFilename.value = 'generated-component.vue'
    showCodePreview.value = true
  }
}

const handleSend = async (content: string) => {
  await sendMessage(content)
}

onMounted(() => {
  loadOrCreateSession()
})

const suggestions = [
  { title: '搜索框组件', desc: '带防抖的输入框，支持下拉建议', prompt: '生成一个搜索框组件，支持输入防抖、下拉建议列表和清除按钮' },
  { title: '商品卡片', desc: '带图片、价格、标签的商品卡片', prompt: '生成一个商品卡片组件，包含商品图片、名称、价格、标签和加入购物车按钮' },
  { title: '数据表格', desc: '支持排序、分页的数据表格', prompt: '生成一个数据表格组件，支持列排序、分页、行选择和空状态' },
  { title: '登录表单', desc: '用户名密码登录，带校验', prompt: '生成一个登录表单组件，包含用户名、密码、验证码和表单校验' },
]
</script>

<template>
  <div class="flex flex-1 h-full overflow-hidden">
    <!-- 中间：对话主区域 -->
    <div class="flex-1 flex flex-col overflow-hidden min-w-0">
      <!-- 顶部工具栏 -->
      <header class="flex items-center justify-between px-6 h-14 bg-white border-b border-slate-200 shrink-0">
        <div class="flex items-center gap-3">
          <h1 class="text-base font-semibold text-slate-800 truncate max-w-[240px]">{{ activeSessionTitle }}</h1>
          <span class="px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 text-[11px] font-medium">对话模式</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="hasMessages"
            class="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-1.5"
            @click="clearCurrentSession"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
            </svg>
            清空
          </button>
          <button
            class="px-3 py-1.5 rounded-lg bg-gradient-primary text-white text-sm font-medium hover:shadow-md transition-all active:scale-[0.98] flex items-center gap-1.5"
            @click="createNewSession"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            新对话
          </button>
        </div>
      </header>

      <!-- 消息区域 -->
      <main class="flex-1 overflow-y-auto px-6 py-6 no-scrollbar">
        <div v-if="!hasMessages" class="flex flex-col items-center justify-center h-full">
          <div class="w-24 h-24 rounded-3xl bg-gradient-primary flex items-center justify-center text-5xl mb-6 shadow-lg shadow-brand-200">
            🎨
          </div>
          <h2 class="text-2xl font-bold text-slate-800 mb-2">AI 组件生成器</h2>
          <p class="text-sm text-slate-500 mb-8 max-w-md text-center leading-relaxed">
            告诉我你想要什么组件，我来帮你生成代码。支持 Vue SFC 和 React TSX 两种框架。
          </p>
          <div class="grid grid-cols-2 gap-3 max-w-2xl w-full">
            <div
              v-for="suggestion in suggestions"
              :key="suggestion.title"
              class="p-4 rounded-2xl bg-white border border-slate-200 hover:border-brand-300 hover:shadow-md transition-all cursor-pointer group"
              @click="handleSend(suggestion.prompt)"
            >
              <p class="text-sm font-medium text-slate-800 mb-1 group-hover:text-brand-600 transition-colors">{{ suggestion.title }}</p>
              <p class="text-xs text-slate-400">{{ suggestion.desc }}</p>
            </div>
          </div>
        </div>

        <div v-else class="max-w-3xl mx-auto space-y-5">
          <template v-for="(msg, idx) in currentMessages" :key="msg.id">
            <ChatBubble
              v-if="msg.role !== 'system'"
              :content="msg.content"
              :role="msg.role"
              :timestamp="msg.timestamp"
              :is-streaming="isLoading && idx === currentMessages.length - 1 && msg.role === 'assistant'"
            />
            <button
              v-if="msg.role === 'assistant' && msg.content.includes('```')"
              class="chip bg-brand-50 text-brand-600 mt-2 active:bg-brand-100 transition-colors"
              @click="openCodePreview(msg.content)"
            >
              📄 查看生成的代码
            </button>
          </template>
        </div>
      </main>

      <!-- 输入区域 -->
      <div class="px-6 pb-6 shrink-0">
        <div class="max-w-3xl mx-auto">
          <ChatInput
            :disabled="isLoading"
            placeholder="描述你想要的组件，例如：带搜索功能的商品卡片... (Enter 发送, Shift+Enter 换行)"
            @send="handleSend"
          />
        </div>
      </div>
    </div>

    <!-- 右侧：代码预览 / 教学面板 -->
    <aside class="w-96 h-full bg-white border-l border-slate-200 flex flex-col shrink-0">
      <!-- Tab 切换 -->
      <div class="flex border-b border-slate-200 shrink-0">
        <button
          class="flex-1 px-4 py-3 text-sm font-medium transition-colors"
          :class="rightPanel === 'teaching' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-slate-500 hover:text-slate-700'"
          @click="rightPanel = 'teaching'"
        >📖 技术拆解</button>
        <button
          class="flex-1 px-4 py-3 text-sm font-medium transition-colors"
          :class="rightPanel === 'code' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-slate-500 hover:text-slate-700'"
          @click="rightPanel = 'code'"
        >💻 代码对照</button>
      </div>

      <!-- 教学面板 -->
      <div v-if="rightPanel === 'teaching'" class="flex-1 overflow-y-auto no-scrollbar">
        <TeachingPanel :messages="currentMessages" :is-loading="isLoading" />
      </div>

      <!-- 代码对照面板 -->
      <div v-else class="flex-1 overflow-y-auto p-4 no-scrollbar">
        <div class="text-center py-12">
          <div class="text-4xl mb-3">🔬</div>
          <p class="text-sm text-slate-500 mb-2">Vue vs React 代码对照</p>
          <p class="text-xs text-slate-400">选择一个已生成的组件查看双框架实现</p>
        </div>
      </div>
    </aside>

    <!-- 代码预览弹窗 -->
    <CodePreview
      :visible="showCodePreview"
      :code="previewCode"
      :filename="previewFilename"
      @close="showCodePreview = false"
    />
  </div>
</template>
