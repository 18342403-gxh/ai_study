<template>
  <div class="space-y-3">
    <label class="block">
      <span class="text-xs text-slate-500">标题</span>
      <input
        :value="modelValue.title"
        class="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none"
        placeholder="例如：三个月 TypeScript 提升计划"
        @input="emitValue({ title: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label class="block">
      <span class="text-xs text-slate-500">目标与背景</span>
      <textarea
        :value="modelValue.goal"
        rows="3"
        class="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none resize-none"
        placeholder="期望结果、衡量方式、当前基础"
        @input="emitValue({ goal: ($event.target as HTMLTextAreaElement).value })"
      />
    </label>

    <div class="grid grid-cols-2 gap-3">
      <label class="block">
        <span class="text-xs text-slate-500">开始时间</span>
        <input
          :value="toDateInput(modelValue.startAt)"
          type="date"
          class="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none"
          @input="emitValue({ startAt: fromDateInput(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <label class="block">
        <span class="text-xs text-slate-500">结束时间</span>
        <input
          :value="toDateInput(modelValue.endAt)"
          type="date"
          class="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none"
          @input="emitValue({ endAt: fromDateInput(($event.target as HTMLInputElement).value) })"
        />
      </label>
    </div>

    <label class="block">
      <span class="text-xs text-slate-500">进度 {{ modelValue.progress }}%</span>
      <input
        :value="modelValue.progress"
        type="range"
        min="0"
        max="100"
        step="5"
        class="mt-2 w-full accent-primary-500"
        @input="emitValue({ progress: Number(($event.target as HTMLInputElement).value) })"
      />
    </label>

    <div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-500">阶段 / 里程碑</span>
        <button
          type="button"
          class="text-[11px] text-primary-600 hover:underline"
          @click="addStage"
        >
          + 添加阶段
        </button>
      </div>

      <div v-if="modelValue.stages.length === 0" class="mt-2 text-xs text-slate-400">
        还没有阶段，可添加 3-8 个按时间推进的里程碑。
      </div>

      <ul v-else class="mt-2 space-y-2">
        <li
          v-for="(stage, index) in modelValue.stages"
          :key="stage.id ?? index"
          class="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 space-y-2"
        >
          <div class="flex items-center gap-2">
            <input
              :checked="stage.done === true"
              type="checkbox"
              class="accent-emerald-500"
              :title="stage.done ? '标记为未完成' : '标记为完成'"
              @change="updateStage(index, { done: ($event.target as HTMLInputElement).checked })"
            />
            <input
              :value="stage.title"
              class="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-slate-200 focus:border-primary-400 focus:outline-none"
              placeholder="阶段标题"
              @input="updateStage(index, { title: ($event.target as HTMLInputElement).value })"
            />
            <input
              :value="toDateInput(stage.targetAt ?? null)"
              type="date"
              class="w-32 px-2 py-1 text-xs rounded border border-slate-200 focus:border-primary-400 focus:outline-none"
              @input="
                updateStage(index, {
                  targetAt: fromDateInput(($event.target as HTMLInputElement).value),
                })
              "
            />
            <button
              type="button"
              class="p-1 text-slate-400 hover:text-rose-500"
              title="删除阶段"
              @click="removeStage(index)"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            :value="stage.description ?? ''"
            class="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:border-primary-400 focus:outline-none"
            placeholder="阶段说明（可选）"
            @input="
              updateStage(index, {
                description: ($event.target as HTMLInputElement).value,
              })
            "
          />
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { PlanFormValue, PlanStage } from '~/utils/api'

const props = defineProps<{ modelValue: PlanFormValue }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: PlanFormValue): void }>()

const emitValue = (patch: Partial<PlanFormValue>) =>
  emit('update:modelValue', { ...props.modelValue, ...patch })

const updateStage = (index: number, patch: Partial<PlanStage>) => {
  const stages = props.modelValue.stages.map((stage, current) =>
    current === index ? { ...stage, ...patch } : stage,
  )
  emitValue({ stages })
}

const addStage = () => {
  emitValue({ stages: [...props.modelValue.stages, { title: '', done: false }] })
}

const removeStage = (index: number) => {
  emitValue({ stages: props.modelValue.stages.filter((_, current) => current !== index) })
}

const pad = (value: number): string => String(value).padStart(2, '0')

const toDateInput = (ms: number | null): string => {
  if (!ms) return ''
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const fromDateInput = (value: string): number | null => {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day).getTime()
}
</script>
