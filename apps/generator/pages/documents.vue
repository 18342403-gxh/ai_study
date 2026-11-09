<template>
  <div class="flex flex-col h-full">
    <header
      class="h-14 flex items-center justify-between px-6 border-b border-slate-100 flex-shrink-0"
    >
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold text-slate-800">文档</h2>
        <span class="text-xs text-slate-400">{{ readyCount }} 篇可检索</span>
      </div>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-primary-500 rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors"
        :disabled="uploading"
        @click="fileInput?.click()"
      >
        <Upload class="w-3.5 h-3.5" />
        {{ uploading ? '上传中…' : '上传文档' }}
      </button>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        accept=".txt,.md,.json,.pdf,.doc,.docx"
        @change="onPick"
      />
    </header>

    <div class="flex-1 overflow-y-auto light-scroll px-6 py-5">
      <!-- 拖拽上传区 -->
      <div
        class="mb-4 px-4 py-6 rounded-xl border-2 border-dashed text-center transition-colors"
        :class="
          dragging ? 'border-primary-400 bg-primary-50' : 'border-slate-200 hover:border-slate-300'
        "
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <p class="text-sm text-slate-600">把文件拖到这里，或点击右上角上传</p>
        <p class="mt-1 text-[11px] text-slate-400">
          支持 txt / md / json / pdf / doc / docx，单个不超过 10MB
        </p>
      </div>

      <p
        v-if="notice"
        class="mb-3 text-xs"
        :class="noticeError ? 'text-rose-500' : 'text-emerald-600'"
      >
        {{ notice }}
      </p>

      <p v-if="loading" class="text-sm text-slate-400">加载中…</p>

      <div v-else-if="rows.length === 0" class="mt-16 text-center">
        <BookOpen class="w-10 h-10 mx-auto text-slate-300" />
        <p class="mt-3 text-sm text-slate-500">还没有上传文档</p>
        <p class="mt-1 text-xs text-slate-400">上传后可以直接在对话里提问，或提取为记录</p>
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="doc in rows"
          :key="doc.id"
          class="group flex items-center gap-3 px-3.5 py-3 rounded-xl border border-slate-100 bg-white hover:border-slate-200 transition-colors"
        >
          <FileText class="w-4 h-4 text-slate-400 flex-shrink-0" />

          <div class="flex-1 min-w-0">
            <p class="text-sm text-slate-800 truncate">{{ doc.name }}</p>
            <p class="mt-0.5 text-[11px] text-slate-400">
              {{ formatSize(doc.size) }} · {{ doc.chunk_count }} 片段 ·
              {{ formatDay(doc.created_at) }}
            </p>
          </div>

          <span class="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0" :class="statusClass(doc)">
            {{ statusLabel(doc.status) }}
          </span>

          <div class="flex items-center gap-0.5 flex-shrink-0">
            <button
              v-if="doc.status === 'ready'"
              class="px-2 py-1 text-[11px] text-primary-600 rounded-lg hover:bg-primary-50 transition-colors"
              :disabled="extracting === doc.id"
              @click="extract(doc)"
            >
              {{ extracting === doc.id ? '提取中…' : '提取为记录' }}
            </button>
            <button
              class="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
              title="删除"
              @click="remove(doc)"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </li>
      </ul>

      <!-- 提取结果：逐条确认入库 -->
      <section v-if="cards.length > 0" class="mt-6">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-medium text-slate-700">
            《{{ extractedDocName }}》提取出 {{ cards.length }} 条
          </h3>
          <button class="text-xs text-slate-400 hover:text-slate-600" @click="cards = []">
            收起
          </button>
        </div>
        <div class="space-y-2">
          <EntryCard
            v-for="item in cards"
            :key="item.key"
            :card="item.card"
            :state="item.state"
            :saving="item.saving"
            @confirm="(payload) => confirmCard(item, payload)"
            @ignore="item.state = 'ignored'"
            @edit="item.state = 'editing'"
            @cancel="item.state = 'pending'"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BookOpen, FileText, Trash2, Upload } from 'lucide-vue-next'
import {
  apiDelete,
  apiGet,
  apiPost,
  apiUpload,
  type CreateEntryPayload,
  type DocumentRow,
  type EntryCard as EntryCardData,
} from '~/utils/api'
import { formatDay } from '~/utils/format'

interface DocExtractResponse {
  ok: boolean
  docId: string
  docName: string
  entries: EntryCardData[]
}

interface CardItem {
  key: string
  card: EntryCardData
  state: 'pending' | 'editing' | 'confirmed' | 'ignored'
  saving: boolean
}

const rows = ref<DocumentRow[]>([])
const loading = ref(true)
const dragging = ref(false)
const uploading = ref(false)
const extracting = ref<string | null>(null)
const notice = ref('')
const noticeError = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const cards = ref<CardItem[]>([])
const extractedDocName = ref('')

const readyCount = computed(() => rows.value.filter((d) => d.status === 'ready').length)

const load = async () => {
  rows.value = await apiGet<DocumentRow[]>('/api/documents')
}

onMounted(async () => {
  try {
    await load()
  } finally {
    loading.value = false
  }
})

const setNotice = (text: string, isError = false) => {
  notice.value = text
  noticeError.value = isError
}

const statusLabel = (s: DocumentRow['status']): string => {
  if (s === 'ready') return '已就绪'
  if (s === 'processing') return '解析中'
  return '解析失败'
}

const statusClass = (doc: DocumentRow): string => {
  if (doc.status === 'ready') return 'bg-emerald-50 text-emerald-600'
  if (doc.status === 'processing') return 'bg-amber-50 text-amber-600'
  return 'bg-rose-50 text-rose-500'
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const onPick = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) upload(file)
  ;(e.target as HTMLInputElement).value = ''
}

const onDrop = (e: DragEvent) => {
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) upload(file)
}

/** 上传后轮询列表，直到该文档离开 processing（最多约 60s） */
const waitProcessed = async (docId: string) => {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    await load()
    const doc = rows.value.find((d) => d.id === docId)
    if (!doc || doc.status !== 'processing') return doc
  }
  return rows.value.find((d) => d.id === docId)
}

const upload = async (file: File) => {
  uploading.value = true
  setNotice('')
  try {
    const form = new FormData()
    form.append('file', file)
    const created = await apiUpload<{ id: string; name: string }>('/api/documents/upload', form)
    await load()
    const doc = await waitProcessed(created.id)
    if (doc?.status === 'ready') {
      setNotice(`《${file.name}》解析成功，共 ${doc.chunk_count} 个片段。`)
    } else if (doc?.status === 'failed') {
      setNotice(`《${file.name}》解析失败，可能是空文档、扫描件或格式不支持。`, true)
    } else {
      setNotice(`《${file.name}》仍在解析，稍后刷新查看。`, true)
    }
  } catch (e) {
    setNotice(`上传失败：${(e as Error).message}`, true)
  } finally {
    uploading.value = false
  }
}

const extract = async (doc: DocumentRow) => {
  extracting.value = doc.id
  setNotice('')
  try {
    const res = await apiPost<DocExtractResponse>(`/api/documents/${doc.id}/extract`, {}, 90_000)
    extractedDocName.value = res.docName
    cards.value = res.entries.map((card, index) => ({
      key: `${index}-${card.title}`,
      card,
      state: 'pending',
      saving: false,
    }))
    if (cards.value.length === 0) setNotice('这篇文档没有可提取的记录。')
  } catch (e) {
    setNotice(`提取失败：${(e as Error).message}`, true)
  } finally {
    extracting.value = null
  }
}

const confirmCard = async (item: CardItem, payload: CreateEntryPayload) => {
  item.saving = true
  try {
    await apiPost('/api/entries', payload)
    item.state = 'confirmed'
  } catch (e) {
    setNotice(`入库失败：${(e as Error).message}`, true)
  } finally {
    item.saving = false
  }
}

const remove = async (doc: DocumentRow) => {
  if (!window.confirm(`删除《${doc.name}》？相关片段会一并删除。`)) return
  await apiDelete(`/api/documents/${doc.id}`)
  rows.value = rows.value.filter((d) => d.id !== doc.id)
}
</script>
