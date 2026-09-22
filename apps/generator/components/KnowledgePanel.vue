<template>
  <div class="h-full flex flex-col">
    <!-- 头部 -->
    <div class="px-6 py-4 border-b border-slate-200">
      <h2 class="text-lg font-semibold text-slate-800">知识库管理</h2>
      <p class="text-xs text-slate-500 mt-1">
        上传 AI 应用相关的文档，组件 / Skill 生成时会自动检索参考
      </p>
    </div>

    <!-- 上传区 -->
    <div class="px-6 py-5 border-b border-slate-100">
      <div class="flex gap-3">
        <!-- 文件上传 -->
        <label
          :class="[
            'flex-1 border-2 border-dashed rounded-xl px-4 py-5 cursor-pointer transition-all',
            isDragging
              ? 'border-primary-400 bg-primary-50'
              : 'border-slate-300 hover:border-primary-300 hover:bg-slate-50',
          ]"
          @dragover.prevent="isDragging = true"
          @dragleave="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <input
            type="file"
            ref="fileInput"
            class="hidden"
            multiple
            accept=".txt,.md,.json,.pdf"
            @change="handleFileSelect"
          />
          <div class="flex items-center gap-3">
            <Upload class="w-7 h-7 text-slate-400 flex-shrink-0" />
            <div>
              <div class="text-sm font-medium text-slate-700">点击或拖拽文件到这里</div>
              <div class="text-[11px] text-slate-400 mt-0.5">
                支持 .txt / .md / .json / .pdf，单文件 ≤ 10MB
              </div>
            </div>
          </div>
        </label>

        <!-- URL 导入 -->
        <div class="w-80 flex-shrink-0">
          <div class="flex gap-2">
            <input
              v-model="urlInput"
              type="url"
              placeholder="粘贴网页 URL"
              class="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              @keyup.enter="importUrl"
            />
            <button
              @click="importUrl"
              :disabled="!urlInput.trim() || urlLoading"
              class="px-3 py-2 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Link class="w-4 h-4" />
            </button>
          </div>
          <p class="text-[11px] text-slate-400 mt-1.5">导入后自动分块 + 向量化</p>
        </div>
      </div>

      <!-- 上传中的文件列表 -->
      <div v-if="uploadQueue.length > 0" class="mt-3 space-y-2">
        <div
          v-for="item in uploadQueue"
          :key="item.name"
          class="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-lg text-sm"
        >
          <FileText class="w-4 h-4 text-slate-400 flex-shrink-0" />
          <span class="flex-1 truncate text-slate-700">{{ item.name }}</span>
          <Loader2
            v-if="item.status === 'uploading'"
            class="w-4 h-4 text-primary-500 animate-spin"
          />
          <Check v-else-if="item.status === 'done'" class="w-4 h-4 text-emerald-500" />
          <X v-else class="w-4 h-4 text-rose-500" />
          <span class="text-[11px] text-slate-400 w-20 text-right">{{ item.sizeLabel }}</span>
        </div>
      </div>

      <!-- 全局错误提示 -->
      <div
        v-if="errorMsg"
        class="mt-3 px-3 py-2 bg-rose-50 text-rose-600 text-sm rounded-lg flex items-center gap-2"
      >
        <AlertTriangle class="w-4 h-4 flex-shrink-0" />
        {{ errorMsg }}
      </div>
    </div>

    <!-- 文档列表 -->
    <div class="flex-1 overflow-y-auto light-scroll px-6 py-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium text-slate-700">已入库文档</h3>
        <span class="text-xs text-slate-400">共 {{ documents.length }} 个</span>
      </div>

      <div v-if="documents.length === 0" class="text-center py-12">
        <BookX class="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p class="text-sm text-slate-500">还没有文档，上传或导入一些试试</p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="doc in documents"
          :key="doc.id"
          class="group flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-lg hover:border-slate-300 hover:shadow-sm transition-all"
        >
          <component :is="getFileIcon(doc.name)" class="w-5 h-5 text-slate-400 flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm text-slate-700 truncate">{{ doc.name }}</span>
              <span
                :class="[
                  'text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0',
                  doc.status === 'ready'
                    ? 'bg-emerald-100 text-emerald-600'
                    : doc.status === 'processing'
                      ? 'bg-amber-100 text-amber-600'
                      : 'bg-rose-100 text-rose-600',
                ]"
              >
                {{ statusLabel(doc.status) }}
              </span>
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5">
              {{ formatSize(doc.size) }} · {{ doc.chunk_count || 0 }} 块 ·
              {{ formatTime(doc.created_at) }}
            </div>
          </div>
          <button
            @click="deleteDoc(doc.id)"
            class="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
            title="删除"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  Upload,
  Link,
  FileText,
  Loader2,
  Check,
  X,
  AlertTriangle,
  BookX,
  Trash2,
  FileJson,
  FileCode,
  File,
} from 'lucide-vue-next'

const config = useRuntimeConfig()
const bffUrl = config.public.bffUrl as string

interface DocumentRow {
  id: string
  name: string
  size: number
  status: 'ready' | 'processing' | 'failed'
  chunk_count: number
  created_at: number
}

interface UploadItem {
  name: string
  sizeLabel: string
  status: 'uploading' | 'done' | 'error'
}

const documents = ref<DocumentRow[]>([])
const uploadQueue = ref<UploadItem[]>([])
const fileInput = ref<HTMLInputElement>()
const isDragging = ref(false)
const urlInput = ref('')
const urlLoading = ref(false)
const errorMsg = ref('')

async function fetchDocs() {
  try {
    const res = await fetch(`${bffUrl}/api/rag/documents`)
    if (res.ok) documents.value = (await res.json()) as DocumentRow[]
  } catch {
    /* ignore */
  }
}

function handleFileSelect(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files) uploadFiles(Array.from(files))
  fileInput.value = undefined
}

function handleDrop(e: DragEvent) {
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files) uploadFiles(Array.from(files))
}

async function uploadFiles(files: File[]) {
  errorMsg.value = ''
  const items: UploadItem[] = files.map((f) => ({
    name: f.name,
    sizeLabel: formatSize(f.size),
    status: 'uploading',
  }))
  uploadQueue.value.push(...items)

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${bffUrl}/api/rag/documents`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${res.status}`)
      }
      items[i].status = 'done'
    } catch (e) {
      items[i].status = 'error'
      errorMsg.value = (e as Error).message
    }
  }

  // 清除上传队列（保留 done 的视觉效果）
  setTimeout(() => {
    uploadQueue.value = uploadQueue.value.filter((i) => i.status !== 'done')
  }, 2000)

  // 刷新文档列表
  await fetchDocs()
}

async function importUrl() {
  const url = urlInput.value.trim()
  if (!url) return
  urlLoading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${bffUrl}/api/rag/documents/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `HTTP ${res.status}`)
    }
    urlInput.value = ''
    await fetchDocs()
  } catch (e) {
    errorMsg.value = (e as Error).message
  } finally {
    urlLoading.value = false
  }
}

async function deleteDoc(id: string) {
  try {
    await fetch(`${bffUrl}/api/rag/documents/${id}`, { method: 'DELETE' })
    documents.value = documents.value.filter((d) => d.id !== id)
  } catch {
    /* ignore */
  }
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'json') return FileJson
  if (ext === 'md') return FileCode
  if (ext === 'txt') return FileText
  return File
}

function formatSize(bytes: number) {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function formatTime(ts: number) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function statusLabel(s: string) {
  return s === 'ready' ? '就绪' : s === 'processing' ? '处理中' : '失败'
}

onMounted(fetchDocs)
</script>
