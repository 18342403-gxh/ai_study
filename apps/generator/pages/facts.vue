<template>
  <div class="flex flex-col h-full">
    <header
      class="h-14 flex items-center justify-between gap-4 px-6 border-b border-slate-100 flex-shrink-0"
    >
      <div class="flex items-center gap-3 flex-shrink-0">
        <h2 class="text-base font-semibold text-slate-800">事实</h2>
        <span class="text-xs text-slate-400">{{ filtered.length }} 条</span>
      </div>
      <div class="relative w-64">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          v-model="keyword"
          placeholder="搜索标题或内容"
          class="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none"
        />
      </div>
    </header>

    <div class="flex-1 overflow-y-auto light-scroll px-6 py-5">
      <p v-if="loading" class="text-sm text-slate-400">加载中…</p>

      <div v-else-if="filtered.length === 0" class="mt-20 text-center">
        <UserRound class="w-10 h-10 mx-auto text-slate-300" />
        <p class="mt-3 text-sm text-slate-500">
          {{ keyword ? '没有匹配的事实' : '还没有记录关于你的事实' }}
        </p>
        <NuxtLink
          v-if="!keyword"
          to="/chat"
          class="mt-2 inline-block text-xs text-primary-500 hover:underline"
        >
          去对话里记一条 →
        </NuxtLink>
      </div>

      <ul v-else class="grid gap-2">
        <li
          v-for="item in filtered"
          :key="item.id"
          class="group p-3.5 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm transition-all cursor-pointer"
          @click="toggle(item.id)"
        >
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-800">{{ item.title }}</p>
              <p
                class="mt-1 text-xs text-slate-500 whitespace-pre-wrap"
                :class="expanded.has(item.id) ? '' : 'line-clamp-2'"
              >
                {{ item.content }}
              </p>
              <p class="mt-1.5 text-[11px] text-slate-400">
                {{ formatDay(item.updatedAt) }} 更新 · 来源 {{ sourceLabel(item) }}
              </p>
            </div>

            <div
              class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            >
              <button
                class="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50"
                title="编辑"
                @click.stop="editing = item"
              >
                <Pencil class="w-3.5 h-3.5" />
              </button>
              <button
                class="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50"
                title="删除"
                @click.stop="remove(item)"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <EntryEditor :entry="editing" @close="editing = null" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { Pencil, Search, Trash2, UserRound } from 'lucide-vue-next'
import { apiDelete, apiGet, type EntryRow } from '~/utils/api'
import { formatDay } from '~/utils/format'

const rows = ref<EntryRow[]>([])
const loading = ref(true)
const keyword = ref('')
const expanded = reactive(new Set<string>())
const editing = ref<EntryRow | null>(null)

onMounted(async () => {
  try {
    rows.value = await apiGet<EntryRow[]>('/api/entries?type=fact&status=active&limit=500')
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rows.value
  return rows.value.filter(
    (r) => r.title.toLowerCase().includes(kw) || r.content.toLowerCase().includes(kw),
  )
})

const toggle = (id: string) => {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}

const sourceLabel = (item: EntryRow): string => {
  if (item.sourceType === 'document') return '文档'
  if (item.sourceType === 'conversation') return '对话'
  return '手动'
}

const remove = async (item: EntryRow) => {
  if (!window.confirm(`删除「${item.title}」？`)) return
  await apiDelete(`/api/entries/${item.id}`)
  rows.value = rows.value.filter((r) => r.id !== item.id)
}

const onSaved = (updated: EntryRow) => {
  rows.value = rows.value.map((r) => (r.id === updated.id ? updated : r))
}
</script>
