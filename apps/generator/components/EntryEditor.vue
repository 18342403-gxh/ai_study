<template>
  <div
    v-if="entry"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
    @click.self="close"
  >
    <div class="w-[520px] max-w-[calc(100vw-32px)] bg-white rounded-xl shadow-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h3 class="text-sm font-semibold text-slate-800">编辑{{ TYPE_LABEL[entry.type] }}</h3>
        <button class="p-1 rounded hover:bg-slate-100" @click="close">
          <X class="w-4 h-4 text-slate-400" />
        </button>
      </div>

      <div class="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto light-scroll">
        <label class="block">
          <span class="text-xs text-slate-500">标题</span>
          <input
            v-model="form.title"
            class="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none"
          />
        </label>

        <label class="block">
          <span class="text-xs text-slate-500">内容</span>
          <textarea
            v-model="form.content"
            rows="4"
            class="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none resize-none"
          />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-xs text-slate-500">开始时间</span>
            <input
              v-model="form.start"
              type="datetime-local"
              class="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none"
            />
          </label>
          <label class="block">
            <span class="text-xs text-slate-500">状态</span>
            <select
              v-model="form.status"
              class="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none bg-white"
            >
              <option value="active">进行中</option>
              <option value="done">已完成</option>
              <option value="archived">已搁置</option>
            </select>
          </label>
        </div>

        <p v-if="error" class="text-xs text-rose-500">{{ error }}</p>
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
import { apiPatch, TYPE_LABEL, type EntryRow, type EntryStatus } from '~/utils/api'
import { fromDateTimeInput, toDateTimeInput } from '~/utils/format'

const props = defineProps<{ entry: EntryRow | null }>()
const emit = defineEmits<{ close: []; saved: [entry: EntryRow] }>()

const form = reactive({
  title: '',
  content: '',
  start: '',
  status: 'active' as EntryStatus,
})
const saving = ref(false)
const error = ref('')

watch(
  () => props.entry,
  (entry) => {
    if (!entry) return
    form.title = entry.title
    form.content = entry.content
    form.start = toDateTimeInput(entry.startAt)
    form.status = entry.status
    error.value = ''
  },
  { immediate: true },
)

const close = () => emit('close')

const save = async () => {
  if (!props.entry) return
  saving.value = true
  error.value = ''
  try {
    const updated = await apiPatch<EntryRow>(`/api/entries/${props.entry.id}`, {
      title: form.title.trim(),
      content: form.content,
      startAt: fromDateTimeInput(form.start),
      status: form.status,
    })
    emit('saved', updated)
    close()
  } catch (e) {
    error.value = (e as Error).message || '保存失败'
  } finally {
    saving.value = false
  }
}
</script>
