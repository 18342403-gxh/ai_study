<template>
  <div class="flex flex-col h-full">
    <header
      class="h-14 flex items-center justify-between px-6 border-b border-slate-100 flex-shrink-0"
    >
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold text-slate-800">日程</h2>
        <span class="text-xs text-slate-400">{{ entries.length }} 项安排</span>
        <button
          class="text-xs text-slate-400 hover:text-primary-500 transition-colors"
          @click="factsOpen = !factsOpen"
        >
          长期事实 {{ facts.length }} {{ factsOpen ? '▴' : '▾' }}
        </button>
      </div>
      <div class="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="px-3 py-1 rounded-md transition-colors"
          :class="
            view === tab.value
              ? 'bg-white text-slate-800 font-medium shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          "
          @click="view = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>
    </header>

    <!-- 长期事实（原事实页合并至此）：无时间属性，以信息条呈现 -->
    <div
      v-if="factsOpen && facts.length > 0"
      class="px-6 pt-3 pb-1 flex flex-wrap gap-1.5 border-b border-slate-100"
    >
      <button
        v-for="f in facts"
        :key="f.id"
        class="max-w-56 truncate px-2.5 py-1 text-[11px] rounded-full bg-slate-100 text-slate-600 hover:bg-primary-50 hover:text-primary-600 transition-colors"
        :title="f.content"
        @click="editing = f"
      >
        {{ f.title }}
      </button>
    </div>

    <div class="flex-1 overflow-auto light-scroll px-6 py-4">
      <p v-if="loading" class="text-sm text-slate-400">加载中…</p>

      <div v-else-if="entries.length === 0" class="mt-20 text-center">
        <Calendar class="w-10 h-10 mx-auto text-slate-300" />
        <p class="mt-3 text-sm text-slate-500">
          {{ view === '2weeks' ? '这两周还没有安排' : '本月还没有安排' }}
        </p>
        <NuxtLink to="/chat" class="mt-2 inline-block text-xs text-primary-500 hover:underline">
          去对话里记一条 →
        </NuxtLink>
      </div>

      <!-- 甘特图 -->
      <div v-else class="select-none" :style="{ minWidth: `${176 + days.length * colMinWidth}px` }">
        <!-- 表头：日期行 -->
        <div class="flex border-b border-slate-200 sticky top-0 bg-white z-10">
          <div class="w-44 flex-shrink-0 px-2 py-2 text-[11px] text-slate-400">安排</div>
          <div class="flex-1 flex">
            <div
              v-for="d in days"
              :key="d.ms"
              class="border-l border-slate-100 text-center py-1"
              :class="d.isToday ? 'bg-primary-50/60' : ''"
              :style="{ width: `${colPct}%` }"
            >
              <p
                class="text-[11px] leading-4"
                :class="d.isToday ? 'text-primary-600 font-semibold' : 'text-slate-600'"
              >
                {{ d.dateNum }}
              </p>
              <p
                class="text-[9px] leading-3"
                :class="d.isToday ? 'text-primary-500' : 'text-slate-400'"
              >
                {{ d.weekday }}
              </p>
            </div>
          </div>
        </div>

        <!-- 条目行 -->
        <div
          v-for="item in entries"
          :key="item.id"
          class="flex items-stretch border-b border-slate-50 hover:bg-slate-50/50"
        >
          <div class="w-44 flex-shrink-0 px-2 py-2 flex items-center gap-1.5 min-w-0">
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              :class="isOverdue(item) ? 'bg-rose-400' : 'bg-primary-400'"
            />
            <p class="text-xs text-slate-700 truncate">{{ item.title }}</p>
          </div>

          <!-- 条区：背景网格 + 条 -->
          <div class="flex-1 relative h-9">
            <div class="absolute inset-0 flex">
              <div
                v-for="d in days"
                :key="d.ms"
                class="border-l border-slate-100 h-full"
                :class="d.isToday ? 'bg-primary-50/40' : ''"
                :style="{ width: `${colPct}%` }"
              />
            </div>
            <!-- 当前时间竖线 -->
            <div
              v-if="nowPct !== null"
              class="absolute top-0 bottom-0 w-px bg-primary-400/70 z-[5]"
              :style="{ left: `${nowPct}%` }"
            />

            <div
              class="absolute top-1/2 -translate-y-1/2 h-[22px] rounded-md text-[10px] leading-[22px] text-white px-1.5 truncate cursor-pointer z-[6]"
              :class="
                isOverdue(item)
                  ? 'bg-rose-400 hover:bg-rose-500'
                  : 'bg-primary-400 hover:bg-primary-500'
              "
              :style="barStyle(item)"
              @click="editing = item"
            >
              {{ item.title }}
              <!-- 悬浮详情卡 -->
              <div
                class="hidden hover-detail absolute bottom-full mb-1.5 w-64 p-3 rounded-xl bg-white border border-slate-200 shadow-xl text-left z-20 cursor-default"
                :class="barLeft(item) > 55 ? 'right-0' : 'left-0'"
                @click.stop
              >
                <div class="flex items-center gap-2">
                  <p class="text-xs font-semibold text-slate-800 truncate">{{ item.title }}</p>
                  <span
                    v-if="isOverdue(item)"
                    class="flex-shrink-0 text-[9px] px-1 py-0.5 rounded bg-rose-50 text-rose-500"
                  >
                    已过期
                  </span>
                  <span
                    v-if="item.recurrence"
                    class="flex-shrink-0 text-[9px] px-1 py-0.5 rounded bg-slate-100 text-slate-500"
                  >
                    {{ recurrenceLabel(item) }}
                  </span>
                </div>
                <p class="mt-1 text-[11px] text-slate-400">
                  {{ item.startAt ? formatDateTime(item.startAt) : '未设时间' }}
                  <template v-if="item.endAt"> — {{ formatDateTime(item.endAt) }}</template>
                </p>
                <p
                  v-if="item.content && item.content !== item.title"
                  class="mt-1.5 text-[11px] leading-4 text-slate-600 line-clamp-3 whitespace-pre-wrap"
                >
                  {{ item.content }}
                </p>
                <div class="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2">
                  <button
                    class="px-2 py-1 text-[10px] rounded-md text-emerald-600 hover:bg-emerald-50"
                    @click="complete(item)"
                  >
                    完成
                  </button>
                  <button
                    class="px-2 py-1 text-[10px] rounded-md text-primary-600 hover:bg-primary-50"
                    @click="editing = item"
                  >
                    编辑
                  </button>
                  <button
                    class="px-2 py-1 text-[10px] rounded-md text-rose-500 hover:bg-rose-50"
                    @click="remove(item)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <EntryEditor :entry="editing" @close="editing = null" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { Calendar } from 'lucide-vue-next'
import { apiDelete, apiGet, apiPatch, type EntryRow } from '~/utils/api'
import { formatDateTime, startOfDay, startOfWeek } from '~/utils/format'

const tabs = [
  { value: '2weeks', label: '双周' },
  { value: 'month', label: '月度' },
] as const

const view = ref<'2weeks' | 'month'>('2weeks')
const entries = ref<EntryRow[]>([])
const facts = ref<EntryRow[]>([])
const factsOpen = ref(false)
const loading = ref(true)
const editing = ref<EntryRow | null>(null)

// ── 时间范围 ──
const rangeStart = computed(() => {
  const now = Date.now()
  if (view.value === '2weeks') return startOfWeek(now)
  const d = new Date(startOfDay(now))
  d.setDate(1)
  return d.getTime()
})

const rangeEnd = computed(() => {
  if (view.value === '2weeks') return rangeStart.value + 14 * 86_400_000
  const d = new Date(rangeStart.value)
  d.setMonth(d.getMonth() + 1)
  return d.getTime()
})

const span = computed(() => rangeEnd.value - rangeStart.value)

const days = computed(() => {
  const count = Math.round(span.value / 86_400_000)
  const todayKey = startOfDay(Date.now())
  const result: Array<{ ms: number; dateNum: number; weekday: string; isToday: boolean }> = []
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六']
  for (let i = 0; i < count; i++) {
    const ms = rangeStart.value + i * 86_400_000
    const d = new Date(ms)
    result.push({
      ms,
      dateNum: d.getDate(),
      weekday: `周${weekdayNames[d.getDay()]}`,
      isToday: ms === todayKey,
    })
  }
  return result
})

const colPct = computed(() => 100 / days.value.length)
/** 列最小宽度：月度视图保持可读 */
const colMinWidth = computed(() => (view.value === 'month' ? 34 : 44))

/** 当前时间在时间轴上的位置（不在范围内为 null） */
const nowPct = computed(() => {
  const now = Date.now()
  if (now < rangeStart.value || now > rangeEnd.value) return null
  return ((now - rangeStart.value) / span.value) * 100
})

// ── 数据 ──
const load = async () => {
  loading.value = true
  try {
    entries.value = await apiGet<EntryRow[]>(
      `/api/entries?type=schedule&status=active&from=${rangeStart.value}&to=${rangeEnd.value}&limit=500`,
    )
  } finally {
    loading.value = false
  }
}

watch(view, load)
onMounted(async () => {
  await load()
  facts.value = await apiGet<EntryRow[]>('/api/entries?type=fact&status=active&limit=200').catch(
    () => [],
  )
})

// ── 条的定位：按真实起止时间占比 ──
const pct = (ms: number): number =>
  Math.min(100, Math.max(0, ((ms - rangeStart.value) / span.value) * 100))

const barLeft = (item: EntryRow): number => pct(item.startAt ?? rangeStart.value)

const barStyle = (item: EntryRow) => {
  const start = item.startAt ?? rangeStart.value
  // 无结束时间的点事件按 1 小时渲染，并保证最小可见宽度
  const end = item.endAt ?? start + 3_600_000
  const left = pct(start)
  const width = Math.max(pct(end) - left, 1.4)
  return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }
}

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

// ── 操作 ──
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
  if (updated.type === 'fact') {
    facts.value = facts.value.map((f) => (f.id === updated.id ? updated : f))
    return
  }
  if (updated.status !== 'active') {
    entries.value = entries.value.filter((e) => e.id !== updated.id)
    return
  }
  entries.value = entries.value.map((e) => (e.id === updated.id ? updated : e))
}
</script>

<style scoped>
/* 悬浮显示详情卡：放在条元素内部，鼠标移到详情卡上时仍保持展开 */
.hover-detail {
  pointer-events: none;
}
div:hover > .hover-detail,
.hover-detail:hover {
  display: block;
  pointer-events: auto;
}
</style>
