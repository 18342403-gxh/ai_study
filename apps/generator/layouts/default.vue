<template>
  <div class="h-full flex bg-slate-100">
    <!-- 左侧边栏 -->
    <aside class="w-56 bg-sidebar-bg border-r border-sidebar-border flex flex-col flex-shrink-0">
      <!-- Logo + 标题 -->
      <div class="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-bold shadow-sm">
          G
        </div>
        <div class="min-w-0">
          <h1 class="text-sm font-semibold text-slate-800 truncate">AI Generator</h1>
          <p class="text-[10px] text-slate-400 truncate">组件 · Skill 生成器</p>
        </div>
      </div>

      <!-- 导航 -->
      <nav class="flex-1 py-2 overflow-y-auto light-scroll">
        <div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">生成</div>

        <button
          @click="activeTab = 'component'"
          :class="[
            'nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            activeTab === 'component'
              ? 'active bg-sidebar-active text-sidebar-activeText font-medium'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
        >
          <span class="text-base">🧩</span>
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
          <span class="text-base">🤖</span>
          <span>Skill 生成</span>
        </button>

        <!-- 分隔线 -->
        <div class="my-3 mx-3 h-px bg-slate-200"></div>

        <div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">历史</div>
        <button
          @click="activeTab = 'history'"
          :class="[
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            activeTab === 'history'
              ? 'active bg-sidebar-active text-sidebar-activeText font-medium'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
        >
          <span class="text-base">📜</span>
          <span>我的生成</span>
          <span v-if="historyCount > 0" class="ml-auto text-[10px] bg-primary-100 text-primary-600 px-1.5 py-0.5 rounded-full">{{ historyCount }}</span>
        </button>
      </nav>

      <!-- 底部 -->
      <div class="border-t border-sidebar-border px-4 py-3 text-[11px] text-slate-400">
        <div>BFF: {{ useRuntimeConfig().public.bffUrl }}</div>
        <div class="mt-0.5">v0.1.0 · {{ useRuntimeConfig().public.appName }}</div>
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

// 共享的 activeTab — layout 管理，provide 给 page 使用
type ArtifactType = 'component' | 'skill' | 'history'
const activeTab = ref<ArtifactType>('component')
provide('activeTab', activeTab)

// 历史记录数量（侧边栏徽章）
const historyCount = ref(0)
const config = useRuntimeConfig()
const bffUrl = config.public.bffUrl as string

async function fetchHistoryCount() {
  try {
    const res = await fetch(`${bffUrl}/api/generator/sessions?limit=1`)
    if (res.ok) {
      const list = await res.json()
      historyCount.value = list.length
    }
  } catch { /* BFF 没启动就静默忽略 */ }
}

onMounted(fetchHistoryCount)
watch(activeTab, (val) => {
  if (val === 'history') fetchHistoryCount()
})
</script>
