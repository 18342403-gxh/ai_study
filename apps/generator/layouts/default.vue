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
        <p class="px-4 pt-1.5 pb-1 text-[10px] font-medium tracking-wider text-slate-400">记忆</p>
        <NuxtLink
          v-for="item in memoryNav"
          :key="item.to"
          :to="item.to"
          class="nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          active-class="active bg-sidebar-active text-sidebar-activeText font-medium"
        >
          <component :is="item.icon" class="w-4 h-4 flex-shrink-0" />
          <span>{{ item.label }}</span>
          <span
            v-if="badgeOf(item.key) !== null"
            class="ml-auto text-[11px] tabular-nums"
            :class="item.key === 'schedule' ? 'text-primary-500' : 'text-slate-400'"
          >
            {{ badgeOf(item.key) }}
          </span>
        </NuxtLink>

        <p class="px-4 pt-3 pb-1 text-[10px] font-medium tracking-wider text-slate-400">资料</p>
        <NuxtLink
          to="/documents"
          class="nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          active-class="active bg-sidebar-active text-sidebar-activeText font-medium"
        >
          <BookOpen class="w-4 h-4 flex-shrink-0" />
          <span>文档</span>
          <span v-if="docCount !== null" class="ml-auto text-[11px] text-slate-400 tabular-nums">
            {{ docCount }}
          </span>
        </NuxtLink>
      </nav>

      <!-- 底部：账户占位 + 版本 -->
      <div class="relative border-t border-sidebar-border px-3 py-2.5">
        <button
          type="button"
          class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          @click="showAccountTip"
        >
          <CircleUser class="w-4 h-4 flex-shrink-0" />
          <span>本机用户</span>
        </button>
        <p
          v-if="accountTip"
          class="absolute bottom-full left-3 right-3 mb-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] shadow-lg"
        >
          账户功能暂未开放
        </p>
        <div class="mt-1 px-2 text-[10px] text-slate-400">
          <div class="truncate">BFF: {{ config.public.bffUrl }}</div>
          <div class="mt-0.5">v0.1.0 · {{ config.public.appName }}</div>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="flex-1 flex flex-col overflow-hidden bg-white">
      <slot />
    </main>

    <LibraryDialog />
  </div>
</template>

<script setup lang="ts">
import { BookOpen, Calendar, CircleUser, MessageSquare, Target, UserRound } from 'lucide-vue-next'
import techCatLogo from '@brand/tech_cat.png'
import { apiGet, type DocumentRow, type EntryRow, type RemindersResponse } from '~/utils/api'

const config = useRuntimeConfig()

const memoryNav = [
  { to: '/chat', label: '对话', icon: MessageSquare, key: 'chat' },
  { to: '/schedule', label: '日程', icon: Calendar, key: 'schedule' },
  { to: '/plans', label: '规划', icon: Target, key: 'plan' },
  { to: '/facts', label: '事实', icon: UserRound, key: 'fact' },
] as const

// ── 徽标：今日日程数 / 进行中规划数 / 可检索文档数（失败静默，不打扰导航） ──
const todayCount = ref<number | null>(null)
const planCount = ref<number | null>(null)
const docCount = ref<number | null>(null)

const badgeOf = (key: string): number | null => {
  if (key === 'schedule') return todayCount.value
  if (key === 'plan') return planCount.value
  return null
}

onMounted(async () => {
  const [reminders, plans, documents] = await Promise.allSettled([
    apiGet<RemindersResponse>('/api/reminders'),
    apiGet<EntryRow[]>('/api/entries?type=plan&status=active&limit=500'),
    apiGet<DocumentRow[]>('/api/documents'),
  ])
  if (reminders.status === 'fulfilled') todayCount.value = reminders.value.today.length
  if (plans.status === 'fulfilled') planCount.value = plans.value.length
  if (documents.status === 'fulfilled') {
    docCount.value = documents.value.filter((d) => d.status === 'ready').length
  }
})

// ── 账户占位提示 ──
const accountTip = ref(false)
let tipTimer: ReturnType<typeof setTimeout> | undefined
const showAccountTip = () => {
  accountTip.value = true
  if (tipTimer) clearTimeout(tipTimer)
  tipTimer = setTimeout(() => {
    accountTip.value = false
  }, 2000)
}
onUnmounted(() => {
  if (tipTimer) clearTimeout(tipTimer)
})
</script>
