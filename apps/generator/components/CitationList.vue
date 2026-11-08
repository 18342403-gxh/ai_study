<template>
  <div class="mt-2.5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
    <div class="text-[10px] font-medium text-slate-400 mb-1.5">依据</div>
    <ul class="space-y-1">
      <li v-for="citation in citations" :key="`${citation.type}-${citation.num}`">
        <button
          type="button"
          class="w-full flex items-center gap-1.5 text-left text-[11px] text-slate-600 hover:text-primary-600 transition-colors group"
          @click="$emit('open', citation)"
        >
          <span
            class="w-4 h-4 rounded flex items-center justify-center bg-white border border-slate-200 text-[10px] text-slate-500 flex-shrink-0 group-hover:border-primary-300"
            >{{ citation.num }}</span
          >
          <span class="truncate">{{ label(citation) }}</span>
          <span class="ml-auto text-[10px] text-slate-400 flex-shrink-0">{{
            kindLabel(citation)
          }}</span>
        </button>
      </li>
    </ul>
  </div>

  <!-- 未命中提示 -->
  <p v-if="missing.length > 0" class="mt-1.5 text-[11px] text-slate-400">
    未命中：{{ missing.join('、') }}
  </p>
</template>

<script setup lang="ts">
import type { Citation } from '~/utils/api'
import { TYPE_LABEL } from '~/utils/api'

defineProps<{
  citations: Citation[]
  missing: string[]
}>()

defineEmits<{ open: [citation: Citation] }>()

const label = (citation: Citation): string => {
  if (citation.type === 'entry') return citation.label
  if (citation.type === 'chunk') return `${citation.docName} · 片段 ${citation.chunkIndex + 1}`
  return citation.text
}

const kindLabel = (citation: Citation): string => {
  if (citation.type === 'entry') return TYPE_LABEL[citation.entryType]
  if (citation.type === 'chunk') return '文档'
  return `汇总 ${citation.remaining} 条`
}
</script>
