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
        {{ uploading ? `上传中…` : '上传文档' }}
      </button>
      <input ref="fileInput" type="file" class="hidden" :accept="DOC_ACCEPT" @change="onPick" />
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
          支持 {{ DOC_LIST_HINT }}，单个不超过 10MB；PDF 需带文字层
        </p>
      </div>

      <!-- 各格式的解析能力说明 -->
      <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div
          v-for="format in DOCUMENT_FORMATS"
          :key="format.key"
          class="px-3 py-2 rounded-lg bg-slate-50 text-[11px] text-slate-500"
        >
          <span class="mr-1.5 px-1 rounded text-[10px] font-medium" :class="format.badgeClass">{{
            format.badge
          }}</span>
          {{ format.hint }}
        </div>
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
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span
                class="px-1 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
                :class="documentBadgeClass(doc)"
                >{{ documentBadge(doc) }}</span
              >
              <p class="text-sm text-slate-800 truncate">{{ doc.name }}</p>
            </div>
            <p class="mt-0.5 text-[11px] text-slate-400">
              {{ formatSize(doc.size) }} · {{ doc.chunk_count }} 片段 ·
              {{ formatDay(doc.created_at) }}
            </p>
            <p v-if="doc.error" class="mt-1 text-[11px] text-rose-500">{{ doc.error }}</p>
            <p
              v-else-if="doc.warnings && doc.warnings.length > 0"
              class="mt-1 text-[11px] text-amber-600"
            >
              {{ doc.warnings[0] }}
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
              v-if="doc.status === 'failed'"
              class="px-2 py-1 text-[11px] text-amber-600 rounded-lg hover:bg-amber-50 transition-colors"
              :disabled="reprocessing === doc.id"
              @click="retry(doc)"
            >
              {{ reprocessing === doc.id ? '重新解析中…' : '重新解析' }}
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
import { BookOpen, Trash2, Upload } from 'lucide-vue-next'
import {
  apiDelete,
  apiGet,
  apiPost,
  apiUpload,
  type CreateEntryPayload,
  type DocumentRow,
  type EntryCard as EntryCardData,
} from '~/utils/api'
import {
  checkFile,
  DOCUMENT_FORMATS,
  DOC_ACCEPT,
  DOC_LIST_HINT,
  documentBadge,
  documentBadgeClass,
  type DocumentFormat,
} from '~/utils/documents'
import { extractPdfText, wrapAsTextFile, type PdfExtractProgress } from '~/utils/pdfExtract'
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
const reprocessing = ref<string | null>(null)
const pdfProgress = ref<PdfExtractProgress | null>(null)
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

/** 上传后轮询列表，直到该文档离开 processing（最多约 150s，覆盖服务端 120s 超时） */
const waitProcessed = async (docId: string): Promise<DocumentRow | undefined> => {
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    await load()
    const doc = rows.value.find((d) => d.id === docId)
    if (!doc || doc.status !== 'processing') return doc
  }
  return rows.value.find((d) => d.id === docId)
}

/** 根据最终状态给出具体结论，失败时直接展示服务端解析错误 */
const reportResult = (fileName: string, doc?: DocumentRow) => {
  if (doc?.status === 'ready') {
    const warning = doc.warnings?.[0]
    setNotice(
      `《${fileName}》解析成功，共 ${doc.chunk_count} 个片段。${warning ? `提示：${warning}` : ''}`,
      Boolean(warning),
    )
  } else if (doc?.status === 'failed') {
    setNotice(`《${fileName}》解析失败：${doc.error ?? '未知原因'}`, true)
  } else {
    setNotice(`《${fileName}》仍在解析，可稍后刷新或点击“重新解析”。`, true)
  }
}

/** 直接上传：txt / md / json / docx / doc 无需前端预处理，原样交给后端 */
const uploadRaw = async (file: File): Promise<{ id: string; name: string }> => {
  const form = new FormData()
  form.append('file', file)
  return apiUpload<{ id: string; name: string }>('/api/documents/upload', form)
}

/**
 * PDF：在浏览器里先提取文字（文字层 / OCR），再以 .txt 形式走后端文本链路。
 * 同时附带原始 PDF 文件名与 kind=pdf，让后端列表仍展示为 PDF，而非 .txt。
 */
const uploadPdf = async (file: File): Promise<{ id: string; name: string }> => {
  setNotice('正在解析 PDF 文字…')
  const extracted = await extractPdfText(file, (p) => {
    pdfProgress.value = p
    const stage =
      p.stage === 'loading'
        ? '加载 PDF'
        : p.stage === 'text'
          ? '提取文字层'
          : p.stage === 'ocr'
            ? 'OCR 识别扫描件'
            : '完成'
    const pct = p.total ? Math.round((p.current / p.total) * 100) : 0
    setNotice(`正在解析 PDF 文字… ${stage} ${p.current}/${p.total}（${pct}%）`)
  })

  const txtFile = wrapAsTextFile(file.name, extracted.text)
  setNotice(
    extracted.method === 'ocr'
      ? `已通过 OCR 识别 ${extracted.pageCount} 页扫描件，正在上传文本…`
      : `已提取 ${extracted.pageCount} 页文字，正在上传文本…`,
  )

  const form = new FormData()
  form.append('file', txtFile)
  // 展示用原始 PDF 名与类型，避免列表里退化成 .txt / TXT
  form.append('name', file.name)
  form.append('kind', 'pdf')
  return apiUpload<{ id: string; name: string }>('/api/documents/upload', form)
}

/** 按格式分派到对应的上传方法，后续新增格式只需加一条 case */
const uploadByFormat = (file: File, format: DocumentFormat) => {
  switch (format.key) {
    case 'pdf':
      return uploadPdf(file)
    case 'txt':
    case 'md':
    case 'json':
    case 'docx':
    case 'doc':
      return uploadRaw(file)
    default:
      return uploadRaw(file)
  }
}

const upload = async (file: File) => {
  uploading.value = true
  pdfProgress.value = null
  setNotice('')
  try {
    // 前端按格式校验：扩展名、体积、文件头，避免无意义的服务端往返
    const check = await checkFile(file)
    if (!check.ok || !check.format) {
      setNotice(check.message ?? '文件校验失败', true)
      return
    }
    if (check.warning) setNotice(check.warning)

    const created = await uploadByFormat(file, check.format)
    await load()
    const doc = await waitProcessed(created.id)
    reportResult(created.name, doc)
  } catch (e) {
    setNotice(`处理失败：${(e as Error).message}`, true)
  } finally {
    uploading.value = false
    pdfProgress.value = null
  }
}

/** 失败或中断后重新解析 */
const retry = async (doc: DocumentRow) => {
  reprocessing.value = doc.id
  setNotice('')
  try {
    await apiPost(`/api/documents/${doc.id}/reprocess`, {})
    await load()
    const updated = await waitProcessed(doc.id)
    reportResult(doc.name, updated)
  } catch (e) {
    setNotice(`重新解析失败：${(e as Error).message}`, true)
  } finally {
    reprocessing.value = null
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
