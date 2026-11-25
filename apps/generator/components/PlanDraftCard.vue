<template>
  <div class="rounded-xl border border-primary-200 bg-primary-50/40 overflow-hidden">
    <div class="px-4 py-3 border-b border-primary-100 bg-white/70">
      <p class="text-sm font-semibold text-slate-800">AI 规划草稿</p>
      <p v-if="draft.grounded" class="mt-1 text-[11px] text-slate-500">
        依据知识库 {{ draft.sources.length }} 条相关内容
        <span v-if="draft.sources.length > 0">：{{ sourceLabels }}</span>
      </p>
      <p v-else class="mt-1 text-[11px] text-amber-600">
        知识库未覆盖相关内容，以下为通用建议。可先编辑，再确认入库。
      </p>
    </div>

    <div class="px-4 py-4 bg-white">
      <PlanForm v-model="form" />
      <p v-if="error" class="mt-3 text-xs text-rose-500">{{ error }}</p>
    </div>

    <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary-100">
      <button
        class="px-3 py-1.5 text-sm text-slate-600 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
        :disabled="saving"
        @click="discard"
      >
        放弃
      </button>
      <button
        class="px-3.5 py-1.5 text-sm text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors"
        :disabled="saving || !form.title.trim()"
        @click="confirm"
      >
        {{ saving ? '处理中…' : '确认入库' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  apiPost,
  type PlanDraft,
  type PlanFormValue,
  type PlanRow,
  type PlanStepResponse,
} from '~/utils/api'

const props = defineProps<{ draft: PlanDraft; threadId: string }>()
const emit = defineEmits<{ (event: 'done', result: { savedPlan: PlanRow | null }): void }>()

const form = ref<PlanFormValue>({
  title: props.draft.title,
  goal: props.draft.goal,
  startAt: props.draft.startAt,
  endAt: props.draft.endAt,
  progress: 0,
  stages: props.draft.stages.map((stage) => ({ ...stage })),
})

const saving = ref(false)
const error = ref('')

const sourceLabels = computed(() =>
  props.draft.sources
    .slice(0, 3)
    .map((source) => source.label)
    .join('、'),
)

const cleanStages = () =>
  form.value.stages
    .filter((stage) => stage.title.trim().length > 0)
    .map((stage) => ({
      id: stage.id,
      title: stage.title.trim(),
      description: stage.description?.trim() || undefined,
      targetAt: stage.targetAt ?? null,
      done: Boolean(stage.done),
    }))

const confirm = async () => {
  if (saving.value || !form.value.title.trim()) return
  saving.value = true
  error.value = ''
  try {
    const result = await apiPost<PlanStepResponse>(
      `/api/plans/drafts/${encodeURIComponent(props.threadId)}/resume`,
      {
        action: 'confirm',
        draft: {
          title: form.value.title.trim(),
          goal: form.value.goal,
          startAt: form.value.startAt,
          endAt: form.value.endAt,
          stages: cleanStages(),
          sources: props.draft.sources,
          grounded: props.draft.grounded,
        },
      },
      75_000,
    )
    emit('done', { savedPlan: result.savedPlan ?? null })
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

const discard = async () => {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    await apiPost<PlanStepResponse>(
      `/api/plans/drafts/${encodeURIComponent(props.threadId)}/resume`,
      { action: 'discard' },
      30_000,
    )
    emit('done', { savedPlan: null })
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}
</script>
