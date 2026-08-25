<script setup lang="ts">
defineProps<{
  content: string
  role: 'user' | 'assistant' | 'system'
  timestamp?: number
  isStreaming?: boolean
}>()

const formatTime = (ts?: number) => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div
    class="flex w-full animate-slide-up"
    :class="role === 'user' ? 'justify-end' : 'justify-start'"
  >
    <div class="flex flex-col max-w-[85%]" :class="role === 'user' ? 'items-end' : 'items-start'">
      <div
        class="msg-bubble"
        :class="[
          role === 'user'
            ? 'bg-gradient-primary text-white rounded-br-md'
            : role === 'system'
              ? 'bg-gray-100 text-gray-500 text-sm italic text-center'
              : 'bg-white card-shadow text-gray-800 rounded-bl-md',
        ]"
      >
        <span v-if="role !== 'system'" class="text-sm leading-relaxed whitespace-pre-wrap">{{ content }}</span>
        <span v-else class="text-xs">{{ content }}</span>

        <span
          v-if="isStreaming"
          class="inline-block w-1.5 h-4 ml-0.5 bg-brand-500 animate-pulse rounded-full"
        />
      </div>
      <span v-if="timestamp" class="text-[10px] text-gray-400 mt-1 px-1">{{ formatTime(timestamp) }}</span>
    </div>
  </div>
</template>
