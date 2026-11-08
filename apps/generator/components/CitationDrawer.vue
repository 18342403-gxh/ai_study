<template>
  <Transition
    enter-active-class="transition-opacity duration-200"
    leave-active-class="transition-opacity duration-150"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div v-if="citation" class="fixed inset-0 z-40 bg-black/20" @click="$emit('close')" />
  </Transition>

  <Transition
    enter-active-class="transition-transform duration-200"
    leave-active-class="transition-transform duration-150"
    enter-from-class="translate-x-full"
    leave-to-class="translate-x-full"
  >
    <aside
      v-if="citation"
      class="fixed right-0 top-0 h-full w-[360px] z-50 bg-white border-l border-slate-200 shadow-xl flex flex-col"
    >
      <div
        class="h-14 px-4 flex items-center justify-between border-b border-slate-100 flex-shrink-0"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="w-5 h-5 rounded flex items-center justify-center bg-slate-100 text-[11px] text-slate-600"
            >{{ citation.num }}</span
          >
          <span class="text-sm font-medium text-slate-800 truncate">{{ title }}</span>
        </div>
        <button
          type="button"
          class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
          @click="$emit('close')"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto light-scroll px-4 py-4">
        <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-3">
          <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{{ kindLabel }}</span>
          <span v-if="timeText">{{ timeText }}</span>
          <span v-if="citation.type === 'entry' && citation.occurrence">重复事件本次实例</span>
        </div>

        <p class="text-sm text-slate-700 leading-6 whitespace-pre-wrap">{{ body }}</p>

        <p v-if="citation.type === 'summary'" class="mt-3 text-[11px] text-slate-400">
          共 {{ citation.remaining }} 条未逐条展示，可在对应记忆页查看完整列表。
        </p>
      </div>

      <div class="px-4 py-3 border-t border-slate-100 text-[11px] text-slate-400 flex-shrink-0">
        <span v-if="citation.type === 'entry'">来源：个人记录</span>
        <span v-else-if="citation.type === 'chunk'">来源：文档《{{ citation.docName }}》</span>
        <span v-else>来源：汇总行</span>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { Citation } from '~/utils/api'
import { TYPE_LABEL } from '~/utils/api'

const props = defineProps<{ citation: Citation | null }>()
defineEmits<{ close: [] }>()

const title = computed(() => {
  const c = props.citation
  if (!c) return ''
  if (c.type === 'entry') return c.label
  if (c.type === 'chunk') return c.docName
  return '汇总'
})

const body = computed(() => {
  const c = props.citation
  if (!c) return ''
  if (c.type === 'summary') return c.text
  return c.snippet
})

const kindLabel = computed(() => {
  const c = props.citation
  if (!c) return ''
  if (c.type === 'entry') return TYPE_LABEL[c.entryType]
  if (c.type === 'chunk') return '文档片段'
  return '汇总'
})

const timeText = computed(() => {
  const c = props.citation
  if (!c || c.type !== 'entry' || c.startAt === null) return ''
  const format = (ms: number) => {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return c.endAt !== null ? `${format(c.startAt)} - ${format(c.endAt)}` : format(c.startAt)
})
</script>
