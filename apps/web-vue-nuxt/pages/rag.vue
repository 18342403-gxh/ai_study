<script setup lang="ts">
const {
  documents,
  isLoading,
  isUploading,
  isDeleting,
  lastResult,
  streamingAnswer,
  streamingSources,
  error,
  loadDocuments,
  uploadDocument,
  deleteDocument,
  queryRagStream,
  clearResult,
} = useRag()

const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const isDragging = ref(false)
const queryInput = ref('')
const isQuerying = ref(false)
const selectedDocIds = ref<string[]>([])
const topK = ref(4)
const activeTab = ref<'documents' | 'query'>('documents')

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 * 1024).toFixed(1)} MB`
}

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const getStatusClass = (status: string): string => {
  switch (status) {
    case 'ready': return 'bg-emerald-50 text-emerald-600 border-emerald-200'
    case 'processing': return 'bg-amber-50 text-amber-600 border-amber-200'
    case 'error': return 'bg-red-50 text-red-600 border-red-200'
    default: return 'bg-slate-50 text-slate-600 border-slate-200'
  }
}

const onDrop = async (e: DragEvent) => {
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    for (const file of Array.from(files)) {
      await handleUpload(file)
    }
  }
}

const onSelectFile = async () => {
  if (selectedFile.value) {
    await handleUpload(selectedFile.value)
    selectedFile.value = null
  }
}

const handleFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    selectedFile.value = target.files[0]
  }
}

const handleUpload = async (file: File) => {
  const allowedTypes = ['text/plain', 'text/markdown', 'application/pdf', 'application/json', 'text/csv']
  const maxSize = 10 * 1024 * 1024

  if (file.size > maxSize) {
    alert(`文件过大，最大支持 ${maxSize / 1024 / 1024}MB`)
    return
  }

  const result = await uploadDocument(file)
  if (result) {
    console.log('文档上传成功:', result)
  }
}

const toggleDocSelection = (id: string) => {
  const idx = selectedDocIds.value.indexOf(id)
  if (idx >= 0) {
    selectedDocIds.value.splice(idx, 1)
  } else {
    selectedDocIds.value.push(id)
  }
}

const handleQuery = async () => {
  if (!queryInput.value.trim() || isQuerying.value) return
  isQuerying.value = true

  const abortController = new AbortController()
  await queryRagStream(
    queryInput.value,
    selectedDocIds.value.length > 0 ? selectedDocIds.value : undefined,
    topK.value,
    abortController.signal
  )

  isQuerying.value = false
}

const handleDelete = async (id: string) => {
  if (!confirm('确定要删除此文档吗？')) return
  await deleteDocument(id)
}

const loadDocs = () => {
  loadDocuments()
}

onMounted(() => {
  loadDocuments()
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto py-8 px-8">
      <header class="mb-6">
        <h1 class="text-2xl font-bold text-slate-800">知识库管理</h1>
        <p class="text-sm text-slate-500 mt-1">上传文档构建知识库，基于 RAG 实现智能问答</p>
      </header>

      <div class="flex gap-2 mb-6">
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium transition-all"
          :class="activeTab === 'documents'
            ? 'bg-brand-500 text-white shadow-sm'
            : 'bg-white text-slate-600 border border-slate-200 hover:border-brand-300'"
          @click="activeTab = 'documents'"
        >📄 文档管理</button>
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium transition-all"
          :class="activeTab === 'query'
            ? 'bg-brand-500 text-white shadow-sm'
            : 'bg-white text-slate-600 border border-slate-200 hover:border-brand-300'"
          @click="activeTab = 'query'"
        >🔍 RAG 查询</button>
      </div>

      <div v-if="activeTab === 'documents'">
        <div
          class="border-2 border-dashed rounded-2xl p-8 mb-6 text-center transition-all"
          :class="isDragging ? 'border-brand-400 bg-brand-50' : 'border-slate-300 hover:border-brand-300'"
          @dragover.prevent="isDragging = true"
          @dragleave="isDragging = false"
          @drop.prevent="onDrop"
        >
          <div class="mb-4">
            <div class="w-16 h-16 mx-auto bg-brand-100 rounded-2xl flex items-center justify-center text-3xl mb-4">
              📁
            </div>
            <h3 class="text-lg font-semibold text-slate-800 mb-1">拖拽文件到此处上传</h3>
            <p class="text-sm text-slate-500">支持 .txt, .md, .json, .csv 文件，最大 10MB</p>
          </div>
          <div class="flex items-center justify-center gap-3">
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              accept=".txt,.md,.json,.csv,.pdf"
              multiple
              @change="handleFileChange"
            />
            <button
              class="px-5 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
              :disabled="isUploading"
              @click="fileInput?.click()"
            >
              {{ isUploading ? '上传中...' : '选择文件' }}
            </button>
            <button
              v-if="selectedFile"
              class="px-5 py-2.5 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors"
              @click="onSelectFile"
            >
              上传: {{ selectedFile.name }}
            </button>
          </div>
          <p v-if="error" class="mt-3 text-sm text-red-500">{{ error }}</p>
        </div>

        <div class="bg-white rounded-2xl border border-slate-200">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 class="text-base font-semibold text-slate-800">文档列表</h3>
            <button
              class="text-sm text-brand-500 hover:text-brand-600 transition-colors"
              @click="loadDocs"
            >🔄 刷新</button>
          </div>

          <div v-if="isLoading && documents.length === 0" class="py-12 flex items-center justify-center text-slate-400">
            <span>加载中...</span>
          </div>

          <div v-else-if="documents.length === 0" class="py-12 text-center text-slate-400">
            <div class="text-4xl mb-3">📭</div>
            <p>暂无文档，上传文件开始构建知识库</p>
          </div>

          <div v-else class="divide-y divide-slate-100">
            <div
              v-for="doc in documents"
              :key="doc.id"
              class="px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors"
            >
              <div class="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-lg shrink-0">
                📄
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-slate-800 truncate">{{ doc.name }}</span>
                  <span
                    class="px-2 py-0.5 text-xs rounded-full border"
                    :class="getStatusClass(doc.status)"
                  >{{ doc.status }}</span>
                </div>
                <div class="text-xs text-slate-400 mt-0.5">
                  {{ formatSize(doc.size) }} · {{ doc.chunk_count }} 个分块 · {{ formatDate(doc.updated_at) }}
                </div>
              </div>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  class="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-300"
                  :checked="selectedDocIds.includes(doc.id)"
                  @change="toggleDocSelection(doc.id)"
                />
                <span class="text-xs text-slate-500">查询</span>
              </label>
              <button
                class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-50"
                :disabled="isDeleting"
                @click="handleDelete(doc.id)"
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-else>
        <div class="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <label class="text-sm font-medium text-slate-700 block mb-2">查询问题</label>
          <textarea
            v-model="queryInput"
            rows="3"
            placeholder="输入你的问题，AI 将基于知识库内容回答..."
            class="w-full text-sm bg-slate-50 rounded-lg px-4 py-3 outline-none border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition resize-none"
          ></textarea>

          <div class="flex items-center justify-between mt-4">
            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2">
                <span class="text-xs text-slate-500">Top-K:</span>
                <select
                  v-model="topK"
                  class="text-sm bg-slate-50 rounded-lg px-3 py-1.5 outline-none border border-slate-200"
                >
                  <option :value="2">2</option>
                  <option :value="4">4</option>
                  <option :value="6">6</option>
                  <option :value="8">8</option>
                  <option :value="10">10</option>
                </select>
              </div>
              <span v-if="selectedDocIds.length > 0" class="text-xs text-slate-500">
                已选 {{ selectedDocIds.length }} 个文档
              </span>
            </div>
            <button
              class="px-5 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
              :disabled="!queryInput.trim() || isQuerying"
              @click="handleQuery"
            >
              {{ isQuerying ? '查询中...' : '🔍 查询' }}
            </button>
          </div>
        </div>

        <div v-if="error" class="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 mb-6">
          {{ error }}
        </div>

        <div v-if="streamingSources.length > 0 || (lastResult && lastResult.sources.length > 0)" class="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <h3 class="text-sm font-semibold text-slate-800 mb-3">📚 参考来源</h3>
          <div class="space-y-2">
            <div
              v-for="(source, idx) in (streamingSources.length > 0 ? streamingSources : lastResult?.sources)"
              :key="idx"
              class="p-3 bg-slate-50 rounded-lg text-sm"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs font-medium text-brand-500">#{{ source.index }}</span>
                <span class="text-xs text-slate-400">相似度: {{ source.score.toFixed(3) }}</span>
              </div>
              <p class="text-slate-600 line-clamp-3">{{ source.content }}</p>
            </div>
          </div>
        </div>

        <div v-if="streamingAnswer || lastResult" class="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 class="text-sm font-semibold text-slate-800 mb-3">💡 AI 回答</h3>
          <div class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
            {{ streamingAnswer || lastResult?.answer }}
            <span v-if="isQuerying" class="inline-block w-0.5 h-4 bg-brand-500 animate-pulse ml-0.5"></span>
          </div>
        </div>

        <div v-if="!streamingAnswer && !lastResult && !isQuerying" class="text-center text-slate-400 py-8">
          <div class="text-4xl mb-3">💬</div>
          <p>输入问题，开始 RAG 查询</p>
        </div>
      </div>
    </div>
  </div>
</template>
