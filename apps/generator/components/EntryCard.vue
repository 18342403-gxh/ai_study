<template>
  <!-- 已确认 / 已忽略：收起为一行 -->
  <div
    v-if="state === 'confirmed' || state === 'ignored'"
    class="flex items-center gap-2 text-sm text-slate-500 py-1.5"
  >
    <span
      class="w-1.5 h-1.5 rounded-full flex-shrink-0"
      :class="state === 'confirmed' ? 'bg-emerald-500' : 'bg-slate-300'"
    />
    <span v-if="state === 'confirmed'">已记录：{{ form.title }}</span>
    <span v-else>已忽略</span>
    <span v-if="state === 'confirmed' && timeLabel" class="text-slate-400">· {{ timeLabel }}</span>
  </div>

  <!-- 待确认 / 修改中 -->
  <div v-else class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
    <!-- 头部：类型徽标 + 标题 -->
    <div class="px-4 py-3 border-b border-slate-100">
      <div class="flex items-start gap-2">
        <span
          class="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5"
          :class="typeClass"
          >{{ TYPE_LABEL[form.type] }}</span
        >
        <template v-if="state === 'editing'">
          <input
            v-model="form.title"
            class="flex-1 text-sm font-medium text-slate-800 px-2 py-1 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
            placeholder="标题"
          />
        </template>
        <h4 v-else class="flex-1 text-sm font-medium text-slate-800 leading-5">
          {{ form.title }}
        </h4>
        <span
          v-if="needsReview"
          class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 flex-shrink-0"
          >需要核对</span
        >
      </div>

      <!-- 字段行 -->
      <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <template v-if="state === 'editing'">
          <label class="flex items-center gap-1">
            <span class="text-slate-400">开始</span>
            <input
              v-model="form.startInput"
              type="datetime-local"
              class="px-1.5 py-0.5 border border-slate-300 rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
          </label>
          <label class="flex items-center gap-1">
            <span class="text-slate-400">结束</span>
            <input
              v-model="form.endInput"
              type="datetime-local"
              class="px-1.5 py-0.5 border border-slate-300 rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
          </label>
        </template>
        <span v-else-if="timeLabel">{{ timeLabel }}</span>
        <span>来自对话</span>
        <span>置信度 {{ Math.round(form.confidence * 100) }}%</span>
      </div>

      <!-- 内容 -->
      <div class="mt-2">
        <textarea
          v-if="state === 'editing'"
          v-model="form.content"
          rows="2"
          class="w-full text-xs text-slate-600 px-2 py-1.5 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
          placeholder="内容"
        />
        <p v-else-if="form.content" class="text-xs text-slate-600 leading-5 whitespace-pre-wrap">
          {{ form.content }}
        </p>
      </div>

      <!-- 编辑态额外：类型选择 -->
      <div v-if="state === 'editing'" class="mt-2 flex items-center gap-1.5">
        <span class="text-[11px] text-slate-400">类型</span>
        <button
          v-for="option in typeOptions"
          :key="option.value"
          type="button"
          class="text-[11px] px-2 py-0.5 rounded border transition-colors"
          :class="
            form.type === option.value
              ? 'border-primary-400 bg-primary-50 text-primary-600'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50'
          "
          @click="form.type = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <!-- 判重提示条：按档位着色（exact=绿 / similar=蓝 / related=黄） -->
    <div v-if="card.duplicate" class="px-4 py-2 border-b" :class="duplicateBannerClass">
      <p class="text-[11px] leading-5" :class="duplicateTextClass">
        {{ duplicateBannerText }}
      </p>
    </div>

    <!-- 其它提示（冲突 / 警告） -->
    <div v-if="otherHints.length > 0" class="px-4 py-2 bg-amber-50/70 border-b border-amber-100">
      <p v-for="(hint, i) in otherHints" :key="i" class="text-[11px] text-amber-700 leading-5">
        {{ hint }}
      </p>
    </div>

    <!-- 操作行 -->
    <div class="px-4 py-2.5 flex items-center gap-2">
      <template v-if="state === 'editing'">
        <button
          type="button"
          class="px-3 py-1.5 bg-primary-500 text-white text-xs rounded-lg hover:bg-primary-600 disabled:opacity-40 transition-colors"
          :disabled="!canSave || saving"
          @click="save"
        >
          保存并入库
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs text-slate-500 rounded-lg hover:bg-slate-100 transition-colors"
          @click="cancelEdit"
        >
          取消
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="px-3 py-1.5 text-white text-xs rounded-lg disabled:opacity-40 transition-colors"
          :class="confirmButtonClass"
          :disabled="saving"
          @click="confirm"
        >
          {{ saving ? '保存中…' : confirmButtonText }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          @click="$emit('edit')"
        >
          修改
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs text-slate-400 rounded-lg hover:bg-slate-100 transition-colors"
          @click="$emit('ignore')"
        >
          忽略
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CreateEntryPayload, EntryCard, EntryType } from '~/utils/api'
import { TYPE_LABEL } from '~/utils/api'

type CardState = 'pending' | 'confirmed' | 'ignored' | 'editing'

const props = defineProps<{
  card: EntryCard
  state: CardState
  saving?: boolean
}>()

const emit = defineEmits<{
  confirm: [payload: CreateEntryPayload]
  ignore: []
  edit: []
  cancel: []
}>()

const typeOptions: Array<{ value: EntryType; label: string }> = [
  { value: 'schedule', label: '日程' },
  { value: 'plan', label: '规划' },
  { value: 'fact', label: '事实' },
  { value: 'note', label: '笔记' },
]

const typeClass = computed(() => {
  switch (props.card.type) {
    case 'schedule':
      return 'bg-blue-50 text-blue-600'
    case 'plan':
      return 'bg-violet-50 text-violet-600'
    case 'fact':
      return 'bg-emerald-50 text-emerald-600'
    default:
      return 'bg-slate-100 text-slate-600'
  }
})

const needsReview = computed(() => props.card.needsReview || props.card.confidence < 0.6)

const toLocalInput = (ms: number | null): string => {
  if (ms === null) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fromLocalInput = (value: string): number | null => (value ? new Date(value).getTime() : null)

const form = reactive({
  type: props.card.type,
  title: props.card.title,
  content: props.card.content,
  startInput: toLocalInput(props.card.time?.start ?? null),
  endInput: toLocalInput(props.card.time?.end ?? null),
  confidence: props.card.confidence,
})

// 切到编辑态时用最新卡片值重置表单
watch(
  () => props.state,
  (state) => {
    if (state !== 'editing') return
    form.type = props.card.type
    form.title = props.card.title
    form.content = props.card.content
    form.startInput = toLocalInput(props.card.time?.start ?? null)
    form.endInput = toLocalInput(props.card.time?.end ?? null)
    form.confidence = props.card.confidence
  },
)

const timeLabel = computed(() => {
  if (props.card.recurrenceText) return props.card.recurrenceText
  const time = props.card.time
  if (!time) return ''
  return time.endText ? `${time.startText} - ${time.endText}` : time.startText
})

const dup = computed(() => props.card.duplicate ?? null)

/** 判重提示条文案：exact/similar 自动合并，related 仍新建 */
const duplicateBannerText = computed(() => {
  const d = dup.value
  if (!d) return ''
  const name = d.title ? `「${d.title}」` : '已有记录'
  if (d.action === 'skip') return `该记录已存在：${name}（${d.reason}），无需重复创建。`
  if (d.action === 'merge')
    return `与已有记录${name}相近（${d.reason}），确认后将更新该记录，不会重复新建。`
  return `与已有记录${name}可能相关（${d.reason}），确认后仍将新建一条。`
})

const duplicateBannerClass = computed(() => {
  switch (dup.value?.level) {
    case 'exact':
      return 'bg-emerald-50/70 border-emerald-100'
    case 'similar':
      return 'bg-sky-50/70 border-sky-100'
    default:
      return 'bg-amber-50/70 border-amber-100'
  }
})

const duplicateTextClass = computed(() => {
  switch (dup.value?.level) {
    case 'exact':
      return 'text-emerald-700'
    case 'similar':
      return 'text-sky-700'
    default:
      return 'text-amber-700'
  }
})

const confirmButtonText = computed(() => {
  switch (dup.value?.action) {
    case 'skip':
      return '已存在'
    case 'merge':
      return '更新已有记录'
    default:
      return '确认入库'
  }
})

const confirmButtonClass = computed(() => {
  switch (dup.value?.action) {
    case 'skip':
      return 'bg-emerald-500 hover:bg-emerald-600'
    case 'merge':
      return 'bg-sky-500 hover:bg-sky-600'
    default:
      return 'bg-primary-500 hover:bg-primary-600'
  }
})

/** 冲突 / 警告 / 模型提示（判重提示单独展示） */
const otherHints = computed(() => {
  const list: string[] = []
  for (const conflict of props.card.conflicts) {
    list.push(`与「${conflict.title ?? '已有日程'}」（${conflict.startText}）时间冲突`)
  }
  if (props.card.duplicateHint) list.push(props.card.duplicateHint)
  for (const warning of props.card.warnings) list.push(warning)
  return list
})

const canSave = computed(() => form.title.trim() !== '')

const buildPayload = (): CreateEntryPayload => {
  const startAt = fromLocalInput(form.startInput)
  const endAt = fromLocalInput(form.endInput)
  return {
    type: form.type,
    title: form.title.trim(),
    content: form.content.trim(),
    status: 'active',
    startAt,
    endAt,
    recurrence: props.card.recurrence,
    sourceType: 'conversation',
    confidence: form.confidence,
  }
}

const confirm = () => emit('confirm', buildPayload())
const save = () => emit('confirm', buildPayload())
const cancelEdit = () => emit('cancel')
</script>
