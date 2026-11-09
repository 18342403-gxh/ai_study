<template>
  <div class="flex flex-col h-full">
    <header
      class="h-14 flex items-center justify-between px-6 border-b border-slate-100 flex-shrink-0"
    >
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold text-slate-800">日程</h2>
        <span class="text-xs text-slate-400">{{ rangeLabel }} · {{ entries.length }} 项</span>
        <button
          class="text-xs text-slate-400 hover:text-primary-500 transition-colors"
          @click="factsOpen = !factsOpen"
        >
          长期事实 {{ facts.length }} {{ factsOpen ? '▴' : '▾' }}
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

      <template v-else>
        <p v-if="entries.length === 0" class="mb-3 text-xs text-slate-400">
          这段时间还没有安排，
          <NuxtLink to="/chat" class="text-primary-500 hover:underline">去对话里记一条 →</NuxtLink>
        </p>

        <!-- 日历网格：周一到周日为列，每周一行 -->
        <div
          class="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden"
        >
          <div
            v-for="w in ['周一', '周二', '周三', '周四', '周五', '周六', '周日']"
            :key="w"
            class="bg-slate-50 py-1.5 text-center text-[11px] text-slate-500"
          >
            {{ w }}
          </div>

          <div
            v-for="cell in cells"
            :key="cell.ms"
            class="bg-white min-h-[92px] p-1.5 align-top"
            :class="[cell.isToday ? 'bg-primary-50/40' : '', cell.outside ? 'opacity-40' : '']"
          >
            <p
              class="text-[11px] leading-4 mb-1"
              :class="cell.isToday ? 'text-primary-600 font-semibold' : 'text-slate-500'"
            >
              {{ cell.label }}
            </p>

            <div class="space-y-1">
              <div
                v-for="item in visibleItems(cell)"
                :key="item.id"
                class="group relative px-1.5 py-0.5 rounded text-[10px] leading-4 text-white truncate cursor-pointer"
                :class="
                  isOverdue(item)
                    ? 'bg-rose-400 hover:bg-rose-500'
                    : 'bg-primary-400 hover:bg-primary-500'
                "
                @click="editing = item"
              >
                {{ item.startAt ? formatTime(item.startAt) : '' }} {{ item.title }}

                <!-- 悬浮详情卡 -->
                <div
                  class="hover-detail hidden absolute top-full mt-1 left-0 w-64 p-3 rounded-xl bg-white border border-slate-200 shadow-xl text-left z-30 cursor-default"
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

              <button
                v-if="hiddenCount(cell) > 0 && expandedDay !== cell.ms"
                class="block text-[10px] text-slate-400 hover:text-primary-500"
                @click="expandedDay = cell.ms"
              >
                +{{ hiddenCount(cell) }} 更多
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <EntryEditor :entry="editing" @close="editing = null" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { apiDelete, apiGet, apiPatch, type EntryRow } from '~/utils/api'
import { formatDateTime, formatTime, startOfDay, startOfWeek } from '~/utils/format'

const DAY = 86_400_000

const entries = ref<EntryRow[]>([])
const facts = ref<EntryRow[]>([])
const factsOpen = ref(false)
const loading = ref(true)
const editing = ref<EntryRow | null>(null)
const expandedDay = ref<number | null>(null)

const weekStart = startOfWeek(Date.now())

// ── 自动选择视图：近两周内有安排 → 双周日历；有更远的安排 → 自然月日历 ──
/** 先按宽范围（本周一起 6 周）拉取，再决定怎么展示 */
const fetchFrom = weekStart
const fetchTo = weekStart + 42 * DAY

const useMonth = computed(() =>
  entries.value.some((e) => e.startAt !== null && e.startAt >= weekStart + 14 * DAY),
)

const rangeLabel = computed(() => {
  if (!useMonth.value) {
    const end = new Date(weekStart + 13 * DAY)
    return `${new Date(weekStart).getMonth() + 1}月${new Date(weekStart).getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`
  }
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
})

// ── 日历格子 ──
interface Cell {
  ms: number
  label: string
  isToday: boolean
  /** 月度视图里不属于当月的日子（仅置灰展示） */
  outside: boolean
}

const cells = computed<Cell[]>(() => {
  const todayKey = startOfDay(Date.now())
  if (!useMonth.value) {
    // 双周：从本周一起 14 天
    return Array.from({ length: 14 }, (_, i) => {
      const ms = weekStart + i * DAY
      const d = new Date(ms)
      return {
        ms,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        isToday: ms === todayKey,
        outside: false,
      }
    })
  }
  // 月度：覆盖自然月的整周（周一为列首）
  const first = new Date()
  first.setDate(1)
  const month = first.getMonth()
  const gridStart = startOfWeek(first.getTime())
  const last = new Date(first)
  last.setMonth(month + 1)
  last.setDate(0)
  const weeks = Math.ceil((startOfDay(last.getTime()) - gridStart) / DAY / 7)
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const ms = gridStart + i * DAY
    const d = new Date(ms)
    return {
      ms,
      label: `${d.getDate()}`,
      isToday: ms === todayKey,
      outside: d.getMonth() !== month,
    }
  })
})

// ── 数据 ──
const load = async () => {
  loading.value = true
  try {
    entries.value = await apiGet<EntryRow[]>(
      `/api/entries?type=schedule&status=active&from=${fetchFrom}&to=${fetchTo}&limit=500`,
    )
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  facts.value = await apiGet<EntryRow[]>('/api/entries?type=fact&status=active&limit=200').catch(
    () => [],
  )
})

/** 按天分组（升序） */
const byDay = computed(() => {
  const map = new Map<number, EntryRow[]>()
  for (const e of entries.value) {
    if (e.startAt === null) continue
    const key = startOfDay(e.startAt)
    const list = map.get(key)
    if (list) list.push(e)
    else map.set(key, [e])
  }
  for (const list of map.values()) list.sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0))
  return map
})

const CELL_LIMIT = 3

const visibleItems = (cell: Cell): EntryRow[] => {
  const list = byDay.value.get(cell.ms) ?? []
  return expandedDay.value === cell.ms ? list : list.slice(0, CELL_LIMIT)
}

const hiddenCount = (cell: Cell): number => {
  const list = byDay.value.get(cell.ms) ?? []
  return Math.max(0, list.length - CELL_LIMIT)
}

// ── 展示辅助 ──
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
/* 悬浮显示详情卡：放在 chip 内部，鼠标移到详情卡上时仍保持展开 */
.hover-detail {
  pointer-events: none;
}
.group:hover > .hover-detail,
.hover-detail:hover {
  display: block;
  pointer-events: auto;
}
</style>
