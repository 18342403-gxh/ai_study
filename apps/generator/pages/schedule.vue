<template>
  <div class="flex flex-col h-full">
    <header
      class="h-14 flex items-center justify-between px-6 border-b border-slate-100 flex-shrink-0"
    >
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold text-slate-800">日程</h2>
        <span class="text-xs text-slate-400">{{ total }} 项安排</span>
      </div>
      <div class="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="px-3 py-1 rounded-md transition-colors"
          :class="
            range === tab.value
              ? 'bg-white text-slate-800 font-medium shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          "
          @click="range = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto light-scroll px-6 py-5">
      <p v-if="loading" class="text-sm text-slate-400">加载中…</p>

      <div v-else-if="total === 0" class="mt-20 text-center">
        <Calendar class="w-10 h-10 mx-auto text-slate-300" />
        <p class="mt-3 text-sm text-slate-500">
          {{ range === 'today' ? '今天还没有安排' : '本周还没有安排' }}
        </p>
        <NuxtLink to="/chat" class="mt-2 inline-block text-xs text-primary-500 hover:underline">
          去对话里记一条 →
        </NuxtLink>
      </div>

      <template v-else>
        <section v-for="group in grouped" :key="group.key" class="mb-6 last:mb-0">
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-sm font-medium text-slate-700">{{ group.label }}</h3>
            <span class="text-xs text-slate-400">{{ group.items.length }}</span>
          </div>

          <ul class="space-y-2">
            <li
              v-for="item in group.items"
              :key="item.id"
              class="group flex items-start gap-3 p-3 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm transition-all"
            >
              <span
                class="w-1 self-stretch rounded-full flex-shrink-0"
                :class="isOverdue(item) ? 'bg-rose-400' : 'bg-primary-400'"
              />

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <p class="text-sm font-medium text-slate-800 truncate">{{ item.title }}</p>
                  <span
                    v-if="isOverdue(item)"
                    class="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-500"
                  >
                    已过期
                  </span>
                  <span
                    v-if="item.recurrence"
                    class="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"
                  >
                    {{ recurrenceLabel(item) }}
                  </span>
                </div>
                <p class="mt-0.5 text-xs text-slate-400">
                  {{ item.startAt ? formatTime(item.startAt) : '未设时间' }}
                  <template v-if="item.endAt"> - {{ formatTime(item.endAt) }}</template>
                </p>
                <p
                  v-if="item.content && item.content !== item.title"
                  class="mt-1 text-xs text-slate-500 line-clamp-2"
                >
                  {{ item.content }}
                </p>
              </div>

              <div
                class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              >
                <button
                  class="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                  title="标记完成"
                  @click="complete(item)"
                >
                  <Check class="w-3.5 h-3.5" />
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
        </section>
      </template>
    </div>

    <EntryEditor :entry="editing" @close="editing = null" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { Calendar, Check, Pencil, Trash2 } from 'lucide-vue-next'
import { apiDelete, apiGet, apiPatch, type EntryRow } from '~/utils/api'
import {
  endOfDay,
  formatDay,
  formatTime,
  relativeDay,
  startOfDay,
  startOfWeek,
} from '~/utils/format'

const tabs = [
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
] as const

const range = ref<'today' | 'week'>('today')
const entries = ref<EntryRow[]>([])
const loading = ref(true)
const editing = ref<EntryRow | null>(null)

const daySpan = 7 * 86_400_000

const load = async () => {
  loading.value = true
  try {
    const now = Date.now()
    const from = range.value === 'today' ? startOfDay(now) : startOfWeek(now)
    const to = range.value === 'today' ? endOfDay(now) : startOfWeek(now) + daySpan
    entries.value = await apiGet<EntryRow[]>(
      `/api/entries?type=schedule&status=active&from=${from}&to=${to}&limit=500`,
    )
  } finally {
    loading.value = false
  }
}

watch(range, load)
onMounted(load)

const total = computed(() => entries.value.length)

/** 按天分组（升序），同一天内按开始时间升序 */
const grouped = computed(() => {
  const map = new Map<number, EntryRow[]>()
  for (const item of entries.value) {
    if (item.startAt === null) continue
    const key = startOfDay(item.startAt)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, items]) => ({
      key,
      label: `${relativeDay(key)}（${formatDay(key)}）`,
      items: items.sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0)),
    }))
})

const isOverdue = (item: EntryRow): boolean => {
  const end = item.endAt ?? (item.startAt === null ? null : item.startAt + 3_600_000)
  return end !== null && end < Date.now()
}

const recurrenceLabel = (item: EntryRow): string => {
  const freq = item.recurrence?.freq
  if (freq === 'DAILY') return '每天'
  if (freq === 'WEEKLY') return '每周'
  if (freq === 'MONTHLY') return '每月'
  return ''
}

const complete = async (item: EntryRow) => {
  await apiPatch<EntryRow>(`/api/entries/${item.id}`, { status: 'done' })
  entries.value = entries.value.filter((e) => e.id !== item.id)
}

const remove = async (item: EntryRow) => {
  if (!window.confirm(`删除「${item.title}」？`)) return
  await apiDelete(`/api/entries/${item.id}`)
  entries.value = entries.value.filter((e) => e.id !== item.id)
}

const onSaved = (updated: EntryRow) => {
  // 完成后不再属于「进行中的日程」，直接移除；其余原地刷新
  if (updated.status !== 'active') {
    entries.value = entries.value.filter((e) => e.id !== updated.id)
    return
  }
  entries.value = entries.value.map((e) => (e.id === updated.id ? updated : e))
}
</script>
