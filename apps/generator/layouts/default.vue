<template>
  <div class="h-full flex bg-slate-100">
    <!-- 左侧边栏 -->
    <aside class="w-56 bg-sidebar-bg border-r border-sidebar-border flex flex-col flex-shrink-0">
      <!-- Logo + 标题 -->
      <div class="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
        <img :src="techCatLogo" alt="个人知识库" class="h-10 w-auto" />
        <div class="min-w-0">
          <h1 class="text-sm font-semibold text-slate-800 truncate">个人知识库</h1>
          <p class="text-[10px] text-slate-400 truncate">Personal Knowledge Base</p>
        </div>
      </div>

      <!-- 导航 -->
      <nav class="flex-1 py-2 overflow-y-auto light-scroll">
        <div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          记忆
        </div>
        <NuxtLink
          to="/chat"
          class="nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          active-class="active bg-sidebar-active text-sidebar-activeText font-medium"
        >
          <MessageSquare class="w-4 h-4" />
          <span>对话</span>
        </NuxtLink>

        <div
          class="px-3 py-1.5 mt-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider"
        >
          资料
        </div>
        <NuxtLink
          to="/"
          class="nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          exact-active-class="active bg-sidebar-active text-sidebar-activeText font-medium"
        >
          <BookOpen class="w-4 h-4" />
          <span>文档</span>
          <span
            v-if="kbCount > 0"
            class="ml-auto text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full"
            >{{ kbCount }}</span
          >
        </NuxtLink>
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
import { ref, onMounted } from 'vue'
import { BookOpen, MessageSquare } from 'lucide-vue-next'
import techCatLogo from '@brand/tech_cat.png'

// 知识库文档数量（侧边栏徽章）
const kbCount = ref(0)
const config = useRuntimeConfig()
const bffUrl = config.public.bffUrl as string

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

onMounted(fetchKbCount)
</script>
