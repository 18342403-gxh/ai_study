<template>
  <div class="h-full flex bg-slate-100">
    <!-- 左侧边栏 -->
    <aside class="w-56 bg-sidebar-bg border-r border-sidebar-border flex flex-col flex-shrink-0">
      <!-- Logo + 标题 -->
      <div class="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
        <img :src="techCatLogo" alt="AI Generator" class="h-10 w-auto" />
        <div class="min-w-0">
          <h1 class="text-sm font-semibold text-slate-800 truncate">AI Generator</h1>
          <p class="text-[10px] text-slate-400 truncate">组件 · Skill 生成器</p>
        </div>
      </div>

      <!-- 导航 -->
      <nav class="flex-1 py-2 overflow-y-auto light-scroll">
        <div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          生成
        </div>

        <button
          @click="activeTab = 'component'"
          :class="[
            'nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            activeTab === 'component'
              ? 'active bg-sidebar-active text-sidebar-activeText font-medium'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
        >
          <Puzzle class="w-4 h-4" />
          <span>组件生成</span>
        </button>

        <button
          @click="activeTab = 'skill'"
          :class="[
            'nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            activeTab === 'skill'
              ? 'active bg-sidebar-active text-sidebar-activeText font-medium'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
        >
          <Bot class="w-4 h-4" />
          <span>Skill 生成</span>
        </button>

        <!-- 分隔线 -->
        <div class="my-3 mx-3 h-px bg-slate-200"></div>

        <div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          历史
        </div>
        <button
          @click="activeTab = 'history'"
          :class="[
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            activeTab === 'history'
              ? 'active bg-sidebar-active text-sidebar-activeText font-medium'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
        >
          <History class="w-4 h-4" />
          <span>我的生成</span>
          <span
            v-if="historyCount > 0"
            class="ml-auto text-[10px] bg-primary-100 text-primary-600 px-1.5 py-0.5 rounded-full"
            >{{ historyCount }}</span
          >
        </button>

        <!-- 分隔线 -->
        <div class="my-3 mx-3 h-px bg-slate-200"></div>

        <div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          知识库
        </div>
        <button
          @click="activeTab = 'kb'"
          :class="[
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            activeTab === 'kb'
              ? 'active bg-sidebar-active text-sidebar-activeText font-medium'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
        >
          <BookOpen class="w-4 h-4" />
          <span>文档管理</span>
          <span
            v-if="kbCount > 0"
            class="ml-auto text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full"
            >{{ kbCount }}</span
          >
        </button>
      </nav>

      <!-- 底部 -->
      <div class="border-t border-sidebar-border px-4 py-3 text-[11px] text-slate-400">
        <div>BFF: {{ config.public.bffUrl }}</div>
        <div class="mt-0.5">v0.1.0 · {{ config.public.appName }}</div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="flex-1 flex flex-col overflow-hidden bg-white">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, provide, watch, onMounted } from 'vue'
import { Bot, Puzzle, History, BookOpen } from 'lucide-vue-next'
import techCatLogo from '@brand/tech_cat.png'

// 共享的 activeTab — layout 管理，provide 给 page 使用
type ArtifactType = 'component' | 'skill' | 'history' | 'kb'
const activeTab = ref<ArtifactType>('component')
provide('activeTab', activeTab)

// 历史记录数量（侧边栏徽章）
const historyCount = ref(0)
// 知识库文档数量（侧边栏徽章）
const kbCount = ref(0)
const config = useRuntimeConfig()
const bffUrl = config.public.bffUrl as string

async function fetchHistoryCount() {
  try {
    const res = await fetch(`${bffUrl}/api/generator/sessions?limit=1`)
    if (res.ok) {
      const list = await res.json()
      historyCount.value = list.length
    }
  } catch {
    /* BFF 没启动就静默忽略 */
  }
}

async function fetchKbCount() {
  try {
    const res = await fetch(`${bffUrl}/api/rag/documents`)
    if (res.ok) {
      const list = await res.json()
      kbCount.value = list.filter((d: any) => d.status === 'ready').length
    }
  } catch {
    /* BFF 没启动就静默忽略 */
  }
}

onMounted(() => {
  fetchHistoryCount()
  fetchKbCount()
})
watch(activeTab, (val) => {
  if (val === 'history') fetchHistoryCount()
  if (val === 'kb') fetchKbCount()
})
</script>
