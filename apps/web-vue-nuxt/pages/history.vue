<script setup lang="ts">
const router = useRouter()

const { sessions, activeSessionId, switchSession, deleteSession, loadOrCreateSession } = useChat()

onMounted(() => {
  loadOrCreateSession()
})

const formatDate = (ts: number) => {
  const now = new Date()
  const d = new Date(ts)
  const diff = now.getTime() - ts

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`

  return `${d.getMonth() + 1}月${d.getDate()}日`
}

const goToSession = (id: string) => {
  switchSession(id)
  router.push('/')
}

const handleDelete = (e: Event, id: string) => {
  e.stopPropagation()
  deleteSession(id)
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-4xl mx-auto py-8 px-8">
      <header class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold text-slate-800">历史会话</h1>
          <p class="text-sm text-slate-500 mt-1">共 {{ sessions.length }} 条会话记录</p>
        </div>
        <button
          class="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors"
          @click="router.push('/')"
        >
          + 新建对话
        </button>
      </header>

      <!-- 空状态 -->
      <div v-if="sessions.length === 0" class="flex flex-col items-center justify-center py-20">
        <div class="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center text-4xl mb-4">
          💬
        </div>
        <h3 class="text-lg font-medium text-slate-700 mb-2">暂无历史会话</h3>
        <p class="text-sm text-slate-400 mb-6">开始你的第一次 AI 对话吧</p>
        <button
          class="px-6 py-2.5 bg-gradient-primary text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
          @click="router.push('/')"
        >
          开始对话
        </button>
      </div>

      <!-- 会话列表 -->
      <div v-else class="space-y-3">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="group p-4 rounded-xl bg-white border transition-all cursor-pointer hover:border-brand-300 hover:shadow-sm"
          :class="session.id === activeSessionId ? 'border-brand-400 bg-brand-50/30 shadow-sm' : 'border-slate-200'"
          @click="goToSession(session.id)"
        >
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h3 class="text-sm font-medium text-slate-800 truncate">{{ session.title }}</h3>
                <span
                  v-if="session.id === activeSessionId"
                  class="px-1.5 py-0.5 text-[10px] bg-brand-100 text-brand-600 rounded shrink-0"
                >当前</span>
              </div>
              <p class="text-xs text-slate-400">
                <span class="inline-flex items-center gap-1">
                  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                  {{ session.messages.length }} 条消息
                </span>
                <span class="mx-2 text-slate-300">·</span>
                {{ formatDate(session.updatedAt) }}
              </p>
            </div>
            <button
              class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
              @click="(e) => handleDelete(e, session.id)"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
