<template>
  <div class="flex flex-col h-full">
    <header
      class="h-14 flex items-center justify-between px-6 border-b border-slate-100 flex-shrink-0"
    >
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold text-slate-800">规划</h2>
        <span class="text-xs text-slate-400">{{ rows.length }} 项</span>
      </div>
      <div class="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="px-3 py-1 rounded-md transition-colors"
          :class="
            status === tab.value
              ? 'bg-white text-slate-800 font-medium shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          "
          @click="status = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto light-scroll px-6 py-5">
      <p v-if="loading" class="text-sm text-slate-400">加载中…</p>

      <div v-else-if="rows.length === 0" class="mt-20 text-center">
        <Target class="w-10 h-10 mx-auto text-slate-300" />
        <p class="mt-3 text-sm text-slate-500">{{ emptyText }}</p>
        <NuxtLink to="/chat" class="mt-2 inline-block text-xs text-primary-500 hover:underline">
          去对话里记一条 →
        </NuxtLink>
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="item in rows"
          :key="item.id"
          class="group flex items-start gap-3 p-3.5 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm transition-all"
        >
          <span
            class="mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
            :class="dotClass(item.status)"
          />

          <div class="flex-1 min-w-0">
            <p
              class="text-sm font-medium truncate"
              :class="item.status === 'archived' ? 'text-slate-400' : 'text-slate-800'"
            >
              {{ item.title }}
            </p>
            <p v-if="item.content" class="mt-1 text-xs text-slate-500 line-clamp-3">
              {{ item.content }}
            </p>
            <p class="mt-1.5 text-[11px] text-slate-400">
              {{ formatDay(item.createdAt) }} 创建 · 来源 {{ sourceLabel(item) }}
            </p>
          </div>

          <div
            class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          >
            <button
              v-if="item.status !== 'done'"
              class="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
              title="标记完成"
              @click="setStatus(item, 'done')"
            >
              <Check class="w-3.5 h-3.5" />
            </button>
            <button
              v-if="item.status !== 'archived'"
              class="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50"
              title="搁置"
              @click="setStatus(item, 'archived')"
            >
              <Archive class="w-3.5 h-3.5" />
            </button>
            <button
              v-if="item.status !== 'active'"
              class="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50"
              title="恢复进行中"
              @click="setStatus(item, 'active')"
            >
              <RotateCcw class="w-3.5 h-3.5" />
            </button>
            <button
              class="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50"
              title="编辑"
              @click="editing = item"
            >
              <Pencil class="w-3.5 h-3.5" />
            </button>
            <button
              class="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50"
              title="删除"
              @click="remove(item)"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </li>
      </ul>
    </div>

    <EntryEditor :entry="editing" @close="editing = null" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { Archive, Check, Pencil, RotateCcw, Target, Trash2 } from 'lucide-vue-next'
import { apiDelete, apiGet, apiPatch, type EntryRow, type EntryStatus } from '~/utils/api'
import { formatDay } from '~/utils/format'

const tabs = [
  { value: 'active', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'archived', label: '已搁置' },
] as const

const status = ref<EntryStatus>('active')
const rows = ref<EntryRow[]>([])
const loading = ref(true)
const editing = ref<EntryRow | null>(null)

const load = async () => {
  loading.value = true
  try {
    rows.value = await apiGet<EntryRow[]>(`/api/entries?type=plan&status=${status.value}&limit=500`)
  } finally {
    loading.value = false
  }
}

watch(status, load)
onMounted(load)

const emptyText = computed(() => {
  if (status.value === 'active') return '还没有进行中的规划'
  if (status.value === 'done') return '还没有完成的规划'
  return '没有已搁置的规划'
})

const dotClass = (s: EntryStatus): string => {
  if (s === 'done') return 'bg-emerald-400'
  if (s === 'archived') return 'bg-slate-300'
  return 'bg-primary-400'
}

const sourceLabel = (item: EntryRow): string => {
  if (item.sourceType === 'document') return '文档'
  if (item.sourceType === 'conversation') return '对话'
  return '手动'
}

const setStatus = async (item: EntryRow, next: EntryStatus) => {
  await apiPatch<EntryRow>(`/api/entries/${item.id}`, { status: next })
  rows.value = rows.value.filter((r) => r.id !== item.id)
}

const remove = async (item: EntryRow) => {
  if (!window.confirm(`删除「${item.title}」？`)) return
  await apiDelete(`/api/entries/${item.id}`)
  rows.value = rows.value.filter((r) => r.id !== item.id)
}

const onSaved = (updated: EntryRow) => {
  // 状态被改出当前分段时，从列表移除；否则原地刷新
  if (updated.status !== status.value) {
    rows.value = rows.value.filter((r) => r.id !== updated.id)
    return
  }
  rows.value = rows.value.map((r) => (r.id === updated.id ? updated : r))
}
</script>
