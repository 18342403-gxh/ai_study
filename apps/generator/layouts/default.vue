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

        <NuxtLink
          to="/learning"
          class="nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          active-class="active bg-sidebar-active text-sidebar-activeText font-medium"
        >
          <Compass class="w-4 h-4 flex-shrink-0" />
          <span>学习</span>
        </NuxtLink>
      </nav>

      <!-- 底部：当前账号 + 版本 -->
      <div class="relative border-t border-sidebar-border px-3 py-2.5">
        <div v-if="authUser" class="space-y-1.5">
          <div class="flex items-center gap-2 px-2">
            <UserRound class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span class="text-xs font-medium text-slate-700 truncate">{{ authUser.username }}</span>
            <span
              v-if="authUser.role === 'admin'"
              class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-600"
            >
              超管
            </span>
          </div>
          <p v-if="remaining" class="px-2 text-[10px] text-amber-600">剩余 {{ remaining }}</p>
          <NuxtLink
            v-if="authUser.role === 'admin'"
            to="/admin/accounts"
            class="nav-item flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
            active-class="active bg-sidebar-active text-sidebar-activeText font-medium"
          >
            <ShieldCheck class="w-4 h-4 flex-shrink-0" />
            <span>临时账号</span>
          </NuxtLink>
          <button
            class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition-colors"
            @click="logout"
          >
            <LogOut class="w-4 h-4 flex-shrink-0" />
            <span>退出登录</span>
          </button>
        </div>
        <div class="mt-2 px-2 text-[10px] text-slate-400">
          <div>v0.1.0 · {{ config.public.appName }}</div>
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
import {
  BookOpen,
  Calendar,
  Compass,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Target,
  UserRound,
} from 'lucide-vue-next'
import techCatLogo from '@brand/tech_cat.png'
import {
  apiGet,
  apiPost,
  type AuthUser,
  type DocumentRow,
  type EntryRow,
  type PlanRow,
  type RemindersResponse,
} from '~/utils/api'

const config = useRuntimeConfig()
const authUser = useState<AuthUser | null>('authUser', () => null)

// ── 临时账号剩余时间 ──
const now = ref(Date.now())
let countdownTimer: ReturnType<typeof setInterval> | undefined
let loggingOut = false

const remaining = computed(() => {
  if (!authUser.value?.expiresAt) return ''
  const diff = authUser.value.expiresAt - now.value
  if (diff <= 0) return '已过期'
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`
})

const logout = async () => {
  if (loggingOut) return
  loggingOut = true
  try {
    await apiPost('/api/auth/logout', {})
  } catch {
    /* 已失效时忽略 */
  }
  authUser.value = null
  await navigateTo('/login')
}

const memoryNav = [
  { to: '/chat', label: '对话', icon: MessageSquare, key: 'chat' },
  { to: '/schedule', label: '日程', icon: Calendar, key: 'schedule' },
  { to: '/plans', label: '规划', icon: Target, key: 'plan' },
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
  countdownTimer = setInterval(() => {
    now.value = Date.now()
    // 临时账号到期：立刻退出，避免继续发起无效请求
    if (authUser.value?.expiresAt && authUser.value.expiresAt <= now.value) {
      void logout()
    }
  }, 30_000)

  const [reminders, plans, legacyPlans, documents] = await Promise.allSettled([
    apiGet<RemindersResponse>('/api/reminders'),
    apiGet<PlanRow[]>('/api/plans?status=active&limit=500'),
    apiGet<EntryRow[]>('/api/entries?type=plan&status=active&limit=500'),
    apiGet<DocumentRow[]>('/api/documents'),
  ])
  if (reminders.status === 'fulfilled') todayCount.value = reminders.value.today.length
  if (plans.status === 'fulfilled' || legacyPlans.status === 'fulfilled') {
    planCount.value =
      (plans.status === 'fulfilled' ? plans.value.length : 0) +
      (legacyPlans.status === 'fulfilled' ? legacyPlans.value.length : 0)
  }
  if (documents.status === 'fulfilled') {
    docCount.value = documents.value.filter((d) => d.status === 'ready').length
  }
})

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>
