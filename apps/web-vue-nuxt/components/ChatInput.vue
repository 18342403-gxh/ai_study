<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  send: [content: string]
}>()

const text = ref('')
const isFocused = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(() => text.value.trim().length > 0 && !props.disabled)

const handleSend = () => {
  if (!canSend.value) return
  emit('send', text.value.trim())
  text.value = ''
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto'
    }
  })
}

const handleInput = (e: Event) => {
  const el = e.target as HTMLTextAreaElement
  text.value = el.value
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="px-3 pt-2 pb-2 safe-bottom">
    <div
      class="flex items-end gap-2 bg-white rounded-2xl px-3 py-2 card-shadow transition-all"
      :class="{ 'ring-2 ring-brand-300': isFocused }"
    >
      <textarea
        ref="textareaRef"
        v-model="text"
        class="flex-1 resize-none text-sm leading-6 outline-none bg-transparent max-h-[120px] no-scrollbar placeholder:text-gray-400"
        :placeholder="placeholder || '描述你想要生成的组件...'"
        :disabled="disabled"
        rows="1"
        @focus="isFocused = true"
        @blur="isFocused = false"
        @input="handleInput"
        @keydown="handleKeydown"
      />
      <button
        class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-40 active:scale-95"
        :class="canSend ? 'bg-gradient-primary text-white' : 'bg-gray-200 text-gray-400'"
        :disabled="!canSend"
        @click="handleSend"
      >
        <svg v-if="!disabled" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M22 2L11 13" />
          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
        <svg v-else class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="32" />
        </svg>
      </button>
    </div>
    <div class="flex gap-2 mt-2 px-1 overflow-x-auto no-scrollbar">
      <button
        v-for="chip in ['搜索框', '数据表格', '卡片列表', '表单页面', '导航菜单']"
        :key="chip"
        class="shrink-0 chip bg-brand-50 text-brand-600 active:bg-brand-100"
        @click="text = chip + '组件'; textareaRef?.focus()"
      >{{ chip }}</button>
    </div>
  </div>
</template>
