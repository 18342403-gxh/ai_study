<template>
  <div class="flex flex-col h-full">
    <header
      class="h-14 flex items-center justify-between px-6 border-b border-slate-100 flex-shrink-0"
    >
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold text-slate-800">长期规划</h2>
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
      <div class="flex items-center justify-end gap-2 mb-4">
        <button
          v-if="aiEnabled"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-primary-200 text-primary-600 hover:bg-primary-50 transition-colors"
          @click="aiOpen = !aiOpen"
        >
          <Sparkles class="w-3.5 h-3.5" />
          AI 生成规划
        </button>
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
          @click="openCreate"
        >
          <Plus class="w-3.5 h-3.5" />
          新建规划
        </button>
      </div>

      <!-- AI 生成面板 -->
      <div v-if="aiEnabled && aiOpen" class="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <template v-if="aiDraft">
          <PlanDraftCard :draft="aiDraft" :thread-id="aiThreadId" @done="onAiDone" />
        </template>

        <template v-else>
          <p class="text-xs text-slate-500">
            描述你的长期目标（例如「帮我做一个三个月的 TypeScript
            学习规划」）。系统会先检索知识库里的个人情况，再生成可编辑的规划草稿。
          </p>
          <textarea
            v-model="aiGoal"
            rows="3"
            class="mt-2 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none resize-none"
            placeholder="想达成什么目标？期望的时间跨度、当前基础、每周可投入时间等"
          />

          <div
            v-if="aiQuestions.length > 0"
            class="mt-3 rounded-lg bg-amber-50 border border-amber-100 p-3"
          >
            <p class="text-xs font-medium text-amber-700">还需要确认：</p>
            <ol class="mt-1.5 list-decimal list-inside text-xs text-amber-700 space-y-1">
              <li v-for="(question, index) in aiQuestions" :key="index">{{ question }}</li>
            </ol>
            <textarea
              v-model="aiAnswer"
              rows="2"
              class="mt-2 w-full px-2.5 py-1.5 text-xs rounded border border-amber-200 focus:border-amber-400 focus:outline-none resize-none bg-white"
              placeholder="每行回答一个问题"
            />
          </div>

          <p v-if="aiError" class="mt-2 text-xs text-rose-500">{{ aiError }}</p>

          <div class="mt-3 flex items-center justify-end gap-2">
            <button
              class="px-3 py-1.5 text-xs text-slate-500 rounded-lg hover:bg-slate-100"
              @click="resetAi"
            >
              取消
            </button>
            <button
              class="px-3.5 py-1.5 text-sm text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50"
              :disabled="aiLoading || (aiQuestions.length === 0 && aiGoal.trim().length < 2)"
              @click="aiQuestions.length > 0 ? answerQuestions() : generate()"
            >
              {{ aiLoading ? '处理中…' : aiQuestions.length > 0 ? '提交回答' : '生成规划' }}
            </button>
          </div>
        </template>
      </div>

      <p v-if="loading" class="text-sm text-slate-400">加载中…</p>

      <div v-else-if="rows.length === 0" class="mt-16 text-center">
        <Target class="w-10 h-10 mx-auto text-slate-300" />
        <p class="mt-3 text-sm text-slate-500">{{ emptyText }}</p>
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="item in rows"
          :key="item.id"
          class="group p-3.5 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm transition-all"
        >
          <div class="flex items-start gap-3">
            <span
              class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
              :class="dotClass(item.status)"
            />

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <p
                  class="text-sm font-medium truncate"
                  :class="item.status === 'archived' ? 'text-slate-400' : 'text-slate-800'"
                >
                  {{ item.title }}
                </p>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                  {{ statusLabel(item.status) }}
                </span>
              </div>
              <p v-if="item.goal" class="mt-1 text-xs text-slate-500 line-clamp-2">
                {{ item.goal }}
              </p>
              <p class="mt-1.5 text-[11px] text-slate-400">
                {{ rangeText(item) }} · 阶段 {{ doneStages(item) }}/{{ item.stages.length }} 完成
              </p>

              <div class="mt-2 flex items-center gap-2">
                <div class="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    class="h-full rounded-full bg-primary-400 transition-all"
                    :style="{ width: `${item.progress}%` }"
                  />
                </div>
                <span class="text-[10px] text-slate-400 w-8 text-right">{{ item.progress }}%</span>
              </div>

              <button
                v-if="item.stages.length > 0"
                type="button"
                class="mt-1.5 text-[11px] text-primary-600 hover:underline"
                @click="expandedId = expandedId === item.id ? null : item.id"
              >
                {{ expandedId === item.id ? '收起阶段' : '查看阶段' }}
              </button>

              <ul v-if="expandedId === item.id" class="mt-2 space-y-1.5">
                <li
                  v-for="(stage, index) in item.stages"
                  :key="stage.id ?? index"
                  class="flex items-start gap-2 text-xs text-slate-600"
                >
                  <Check
                    v-if="stage.done"
                    class="w-3.5 h-3.5 mt-0.5 text-emerald-500 flex-shrink-0"
                  />
                  <span
                    v-else
                    class="mt-1 w-2.5 h-2.5 rounded-full border border-slate-300 flex-shrink-0"
                  />
                  <span class="min-w-0">
                    <span :class="stage.done ? 'text-slate-400 line-through' : ''">
                      {{ stage.title }}
                    </span>
                    <span v-if="stage.targetAt" class="ml-1 text-[10px] text-slate-400">
                      {{ formatDay(stage.targetAt) }}
                    </span>
                    <span v-if="stage.description" class="block text-[11px] text-slate-400">
                      {{ stage.description }}
                    </span>
                  </span>
                </li>
              </ul>
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
                @click="openEdit(item)"
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
          </div>
        </li>
      </ul>

      <!-- 旧版规划（entries.type=plan） -->
      <section class="mt-8 border-t border-slate-100 pt-4">
        <button
          type="button"
          class="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
          @click="toggleLegacy"
        >
          <ChevronDown
            class="w-3.5 h-3.5 transition-transform"
            :class="legacyOpen ? 'rotate-180' : ''"
          />
          旧版规划（{{ legacyRows.length }} 项）
        </button>

        <div v-if="legacyOpen" class="mt-3">
          <p v-if="legacyLoading" class="text-xs text-slate-400">加载中…</p>
          <p v-else-if="legacyRows.length === 0" class="text-xs text-slate-400">没有旧版规划条目</p>
          <ul v-else class="space-y-2">
            <li
              v-for="item in legacyRows"
              :key="item.id"
              class="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50/50"
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm text-slate-700 truncate">{{ item.title }}</p>
                <p v-if="item.content" class="mt-0.5 text-xs text-slate-500 line-clamp-2">
                  {{ item.content }}
                </p>
                <p class="mt-1 text-[11px] text-slate-400">
                  {{
                    item.status === 'done' ? '已完成' : item.status === 'draft' ? '草稿' : '进行中'
                  }}
                  · {{ formatDay(item.createdAt) }}
                </p>
              </div>
              <button
                class="flex-shrink-0 px-2.5 py-1 text-[11px] rounded-lg border border-primary-200 text-primary-600 hover:bg-primary-50 disabled:opacity-50"
                :disabled="convertingId === item.id"
                @click="convert(item)"
              >
                {{ convertingId === item.id ? '转换中…' : '转为长期规划' }}
              </button>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <PlanEditor
      v-if="editorOpen"
      :plan="editingPlan"
      @close="editorOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import {
  Archive,
  Check,
  ChevronDown,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-vue-next'
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  type EntryRow,
  type PlanCapabilities,
  type PlanDraft,
  type PlanRow,
  type PlanStatus,
  type PlanStepResponse,
} from '~/utils/api'
import { formatDay } from '~/utils/format'

const tabs = [
  { value: 'active', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'archived', label: '已搁置' },
] as const

const status = ref<PlanStatus>('active')
const rows = ref<PlanRow[]>([])
const loading = ref(true)
const expandedId = ref<string | null>(null)

const editorOpen = ref(false)
const editingPlan = ref<PlanRow | null>(null)

// AI 面板
const aiEnabled = ref(true)
const aiOpen = ref(false)
const aiGoal = ref('')
const aiAnswer = ref('')
const aiLoading = ref(false)
const aiError = ref('')
const aiQuestions = ref<string[]>([])
const aiThreadId = ref('')
const aiDraft = ref<PlanDraft | null>(null)

// 旧版规划
const legacyOpen = ref(false)
const legacyLoading = ref(false)
const legacyRows = ref<EntryRow[]>([])
const convertingId = ref<string | null>(null)

const load = async () => {
  loading.value = true
  try {
    rows.value = await apiGet<PlanRow[]>(`/api/plans?status=${status.value}&limit=500`)
  } finally {
    loading.value = false
  }
}

const loadLegacy = async () => {
  legacyLoading.value = true
  try {
    const entries = await apiGet<EntryRow[]>('/api/entries?type=plan&limit=500')
    legacyRows.value = entries.filter((item) => item.status !== 'archived')
  } finally {
    legacyLoading.value = false
  }
}

const toggleLegacy = async () => {
  legacyOpen.value = !legacyOpen.value
  if (legacyOpen.value && legacyRows.value.length === 0) await loadLegacy()
}

watch(status, () => {
  expandedId.value = null
  void load()
})

onMounted(async () => {
  void loadLegacy()
  try {
    const capabilities = await apiGet<PlanCapabilities>('/api/plans/capabilities')
    aiEnabled.value = capabilities.aiEnabled
  } catch {
    /* 后端不可用时保持默认，生成时会给出错误 */
  }
  await load()
})

const emptyText = computed(() => {
  if (status.value === 'active') return '还没有进行中的长期规划'
  if (status.value === 'done') return '还没有完成的长期规划'
  return '没有已搁置的长期规划'
})

const statusLabel = (value: PlanStatus): string => {
  if (value === 'done') return '已完成'
  if (value === 'archived') return '已搁置'
  if (value === 'draft') return '草稿'
  return '进行中'
}

const dotClass = (value: PlanStatus): string => {
  if (value === 'done') return 'bg-emerald-400'
  if (value === 'archived') return 'bg-slate-300'
  return 'bg-primary-400'
}

const doneStages = (item: PlanRow): number => item.stages.filter((stage) => stage.done).length

const rangeText = (item: PlanRow): string => {
  const start = item.startAt ? formatDay(item.startAt) : '未定'
  const end = item.endAt ? formatDay(item.endAt) : '未定'
  return `${start} → ${end}`
}

const openCreate = () => {
  editingPlan.value = null
  editorOpen.value = true
}

const openEdit = (item: PlanRow) => {
  editingPlan.value = item
  editorOpen.value = true
}

const onSaved = (saved: PlanRow) => {
  editorOpen.value = false
  rows.value =
    saved.status === status.value
      ? rows.value.some((item) => item.id === saved.id)
        ? rows.value.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...rows.value]
      : rows.value.filter((item) => item.id !== saved.id)
}

const setStatus = async (item: PlanRow, next: PlanStatus) => {
  await apiPatch<PlanRow>(`/api/plans/${item.id}`, { status: next })
  rows.value = rows.value.filter((row) => row.id !== item.id)
}

const remove = async (item: PlanRow) => {
  if (!window.confirm(`删除「${item.title}」？`)) return
  await apiDelete(`/api/plans/${item.id}`)
  rows.value = rows.value.filter((row) => row.id !== item.id)
}

// ── AI 生成 ─────────────────────────────────────────

const resetAi = () => {
  aiOpen.value = false
  aiGoal.value = ''
  aiAnswer.value = ''
  aiError.value = ''
  aiQuestions.value = []
  aiThreadId.value = ''
  aiDraft.value = null
}

const applyStep = (step: PlanStepResponse) => {
  aiThreadId.value = step.threadId
  aiError.value = ''
  if (step.stage === 'ask') {
    aiQuestions.value = step.questions ?? []
    aiDraft.value = null
    return
  }
  if (step.stage === 'confirm' && step.draft) {
    aiQuestions.value = []
    aiDraft.value = step.draft
    return
  }
  // done
  void load()
  void loadLegacy()
  const title = step.savedPlan?.title
  resetAi()
  if (title) window.alert(`规划「${title}」已创建`)
}

const generate = async () => {
  const goal = aiGoal.value.trim()
  if (goal.length < 2 || aiLoading.value) return
  aiLoading.value = true
  aiError.value = ''
  try {
    const step = await apiPost<PlanStepResponse>('/api/plans/generate', { goal }, 120_000)
    applyStep(step)
  } catch (error) {
    aiError.value = (error as Error).message
  } finally {
    aiLoading.value = false
  }
}

const answerQuestions = async () => {
  const answers = aiAnswer.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (answers.length === 0 || !aiThreadId.value || aiLoading.value) return
  aiLoading.value = true
  aiError.value = ''
  try {
    const step = await apiPost<PlanStepResponse>(
      `/api/plans/drafts/${encodeURIComponent(aiThreadId.value)}/resume`,
      { answers },
      120_000,
    )
    aiAnswer.value = ''
    applyStep(step)
  } catch (error) {
    aiError.value = (error as Error).message
  } finally {
    aiLoading.value = false
  }
}

const onAiDone = () => {
  resetAi()
  void load()
  void loadLegacy()
}

// ── 旧版规划转换 ─────────────────────────────────────

const convert = async (item: EntryRow) => {
  if (convertingId.value) return
  convertingId.value = item.id
  try {
    await apiPost<PlanRow>('/api/plans', { fromEntryId: item.id })
    legacyRows.value = legacyRows.value.filter((row) => row.id !== item.id)
    await load()
  } catch (error) {
    window.alert((error as Error).message)
  } finally {
    convertingId.value = null
  }
}
</script>
