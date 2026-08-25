<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  code: string
  language?: string
  filename?: string
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  copy: [code: string]
}>()

const copied = ref(false)
const activeTab = ref<'code' | 'preview'>('code')

const onCopy = async () => {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
    emit('copy', props.code)
  } catch {}
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex flex-col bg-white animate-slide-up"
    >
      <header class="flex items-center justify-between px-4 h-12 safe-top bg-white hairline">
        <button
          class="w-8 h-8 flex items-center justify-center text-gray-500 active:text-brand-500"
          @click="emit('close')"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span class="text-sm font-medium text-gray-800 truncate px-2">{{ filename || 'component.vue' }}</span>
        <button
          class="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
          :class="copied ? 'bg-mint-500 text-white' : 'bg-brand-50 text-brand-600'"
          @click="onCopy"
        >
          <svg v-if="!copied" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </button>
      </header>

      <div class="flex border-b border-gray-100">
        <button
          class="flex-1 py-2 text-sm font-medium transition-colors"
          :class="activeTab === 'code' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-gray-500'"
          @click="activeTab = 'code'"
        >代码</button>
        <button
          class="flex-1 py-2 text-sm font-medium transition-colors"
          :class="activeTab === 'preview' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-gray-500'"
          @click="activeTab = 'preview'"
        >预览</button>
      </div>

      <div class="flex-1 overflow-hidden">
        <div v-if="activeTab === 'code'" class="h-full overflow-auto bg-gray-50 p-4 no-scrollbar">
          <pre class="text-xs leading-relaxed text-gray-800"><code>{{ code }}</code></pre>
        </div>
        <div v-else class="h-full overflow-auto p-4 no-scrollbar">
          <div class="border border-gray-200 rounded-xl overflow-hidden min-h-[300px] bg-gray-50">
            <div class="bg-white p-8 flex items-center justify-center min-h-[280px]">
              <div v-html="code" class="text-sm text-gray-600 text-center" />
              <p v-if="!code" class="text-center text-gray-400">
                <span class="text-4xl block mb-2">🎨</span>
                预览功能开发中...
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
