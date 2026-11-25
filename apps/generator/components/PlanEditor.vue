<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
    @click.self="close"
  >
    <div class="w-[560px] max-w-[calc(100vw-32px)] bg-white rounded-xl shadow-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h3 class="text-sm font-semibold text-slate-800">
          {{ plan ? '编辑长期规划' : '新建长期规划' }}
        </h3>
        <button class="p-1 rounded hover:bg-slate-100" @click="close">
          <X class="w-4 h-4 text-slate-400" />
        </button>
      </div>

      <div class="px-5 py-4 max-h-[70vh] overflow-y-auto light-scroll">
        <PlanForm v-model="form" />
        <p v-if="error" class="mt-3 text-xs text-rose-500">{{ error }}</p>
      </div>

      <div
        class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50"
      >
        <button
          class="px-3 py-1.5 text-sm text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          @click="close"
        >
          取消
        </button>
        <button
          class="px-3.5 py-1.5 text-sm text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors"
          :disabled="saving || !form.title.trim()"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { apiPatch, apiPost, type PlanFormValue, type PlanRow } from '~/utils/api'

const props = defineProps<{ plan?: PlanRow | null }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'saved', plan: PlanRow): void
}>()

const cleanStages = (stages: PlanFormValue['stages']) =>
  stages
    .filter((stage) => stage.title.trim().length > 0)
    .map((stage) => ({
      id: stage.id,
      title: stage.title.trim(),
      description: stage.description?.trim() || undefined,
      targetAt: stage.targetAt ?? null,
      done: Boolean(stage.done),
    }))

const form = ref<PlanFormValue>({
  title: props.plan?.title ?? '',
  goal: props.plan?.goal ?? '',
  startAt: props.plan?.startAt ?? Date.now(),
  endAt: props.plan?.endAt ?? null,
  progress: props.plan?.progress ?? 0,
  stages: (props.plan?.stages ?? []).map((stage) => ({ ...stage })),
})

const saving = ref(false)
const error = ref('')

const close = () => emit('close')

const save = async () => {
  if (!form.value.title.trim() || saving.value) return
  saving.value = true
  error.value = ''
  const body = {
    title: form.value.title.trim(),
    goal: form.value.goal,
    startAt: form.value.startAt,
    endAt: form.value.endAt,
    progress: form.value.progress,
    stages: cleanStages(form.value.stages),
  }
  try {
    const saved = props.plan
      ? await apiPatch<PlanRow>(`/api/plans/${props.plan.id}`, body)
      : await apiPost<PlanRow>('/api/plans', body)
    emit('saved', saved)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}
</script>
