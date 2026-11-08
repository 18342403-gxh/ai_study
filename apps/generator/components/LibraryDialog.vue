<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-100"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div class="absolute inset-0 bg-black/30" @click="close" />
        <div
          class="relative w-full max-w-3xl h-[76vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        >
          <div
            class="h-12 px-5 flex items-center justify-between border-b border-slate-100 flex-shrink-0"
          >
            <div class="flex items-center gap-2">
              <Library class="w-4 h-4 text-slate-400" />
              <h3 class="text-sm font-semibold text-slate-800">资料库</h3>
              <span class="text-[11px] text-slate-400">上传后即可在对话中被检索</span>
            </div>
            <button
              type="button"
              class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
              @click="close"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
          <div class="flex-1 min-h-0">
            <KnowledgePanel />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { Library, X } from 'lucide-vue-next'

const open = useState<boolean>('libraryOpen', () => false)
const close = () => {
  open.value = false
}
</script>
