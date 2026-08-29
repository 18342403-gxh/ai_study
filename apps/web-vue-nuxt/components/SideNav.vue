<script setup lang="ts">
/**
 * 💡 JS 基础补充：props 类型声明
 * Vue 3.3+ 支持 defineProps<泛型接口>()，比 defineProps({ type: String }) 更类型安全
 * 这是 Vue3 + TS 工程化的核心知识点之一
 *
 * 🤖 AI 场景价值：侧边导航是 AI 产品的「骨架」，
 * 所有功能入口都通过它触达，必须支持路由高亮、会话切换等状态联动
 *
 * 🤝 与 React 对照：
 * Vue: defineProps<T>() ↔ React: 组件参数解构 + TypeScript 接口
 */

const route = useRoute()
const router = useRouter()

const navItems = [
  { key: 'generate', label: '组件生成', icon: '✨', to: '/', desc: 'AI 对话生成组件代码' },
  { key: 'rag', label: '知识库', icon: '📚', to: '/rag', desc: 'RAG 文档管理与查询' },
  { key: 'agent', label: 'Agent 调试', icon: '🤖', to: '/agent', desc: '多步推理与工具调用' },
  { key: 'history', label: '历史会话', icon: '🕐', to: '/history', desc: '多轮对话历史管理' },
  { key: 'library', label: '模板库', icon: '🎨', to: '/library', desc: '预设组件模板' },
  { key: 'settings', label: '设置', icon: '⚙️', to: '/settings', desc: 'API 配置' },
]

const activeKey = computed(() => {
  const path = route.path
  if (path === '/' || path === '') return 'generate'
  return navItems.find((t) => path.startsWith(t.to))?.key ?? 'generate'
})
</script>

<template>
  <aside
    class="w-60 h-full bg-white border-r border-slate-200 flex flex-col shrink-0"
  >
    <!-- Logo 区域 -->
    <div class="h-16 px-5 flex items-center gap-3 border-b border-slate-100">
      <div class="w-9 h-9 rounded-xl bg-gradient-primary flex items-center justify-center text-lg">
        ✨
      </div>
      <div class="flex flex-col">
        <h1 class="text-sm font-bold text-slate-800">AI 组件生成器</h1>
        <span class="text-[11px] text-brand-500">Nuxt 3 SSR · Web</span>
      </div>
    </div>

    <!-- 新建会话按钮 -->
    <div class="p-3">
      <button
        class="w-full h-10 rounded-xl bg-gradient-primary text-white text-sm font-medium transition-all hover:shadow-lg hover:shadow-brand-200 active:scale-[0.98] flex items-center justify-center gap-2"
        @click="router.push('/')"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新建对话
      </button>
    </div>

    <!-- 导航菜单 -->
    <nav class="flex-1 px-3 space-y-1">
      <NuxtLink
        v-for="item in navItems"
        :key="item.key"
        :to="item.to"
        class="group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
        :class="activeKey === item.key
          ? 'bg-brand-50 text-brand-700'
          : 'text-slate-600 hover:bg-slate-50'"
      >
        <span class="text-lg" :class="activeKey === item.key ? '' : 'opacity-60'">{{ item.icon }}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">{{ item.label }}</p>
          <p class="text-[11px] truncate" :class="activeKey === item.key ? 'text-brand-400' : 'text-slate-400'">
            {{ item.desc }}
          </p>
        </div>
        <span
          v-if="activeKey === item.key"
          class="w-1.5 h-1.5 rounded-full bg-brand-500"
        />
      </NuxtLink>
    </nav>

    <!-- 底部信息 -->
    <div class="px-5 py-4 border-t border-slate-100">
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-500">
          AI
        </div>
        <div class="flex flex-col">
          <span class="text-xs font-medium text-slate-700">AI 学习平台</span>
          <span class="text-[10px] text-slate-400">v0.1.0</span>
        </div>
      </div>
    </div>
  </aside>
</template>
