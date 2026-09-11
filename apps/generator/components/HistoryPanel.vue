<script setup lang="ts">
import { ref, onMounted } from 'vue'

const config = useRuntimeConfig()
const bffUrl = config.public.bffUrl as string

type HistorySession = {
  id: string
  requirement: string
  artifact_type: 'component' | 'skill'
  framework: 'vue' | 'react' | null
  skill_name: string | null
  status: string
  iteration: number
  file_count: number
  created_at: number
  updated_at: number
}

const loading = ref(true)
const sessions = ref<HistorySession[]>([])
const errorMsg = ref('')
const expandedId = ref<string | null>(null)
const detail = ref<any>(null)
const detailLoading = ref(false)

async function fetchList() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${bffUrl}/api/generator/sessions?limit=50`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    sessions.value = await res.json()
  } catch (e) {
    errorMsg.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function toggleDetail(id: string) {
  if (expandedId.value === id) {
    expandedId.value = null
    detail.value = null
    return
  }
  expandedId.value = id
  detailLoading.value = true
  try {
    const res = await fetch(`${bffUrl}/api/generator/sessions/${id}`)
    if (res.ok) detail.value = await res.json()
  } catch { /* ignore */ }
  finally {
    detailLoading.value = false
  }
}

async function deleteSession(id: string) {
  if (!confirm('确定要删除这条记录吗？')) return
  try {
    await fetch(`${bffUrl}/api/generator/sessions/${id}`, { method: 'DELETE' })
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (expandedId.value === id) { expandedId.value = null; detail.value = null }
  } catch { /* ignore */ }
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function downloadFile(f: { path?: string; file_path?: string; content: string }) {
  const blob = new Blob([f.content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const fileName = (f.file_path || f.path || 'file.txt').split('/').pop() || 'file.txt'
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function statusColor(s: string) {
  switch (s) {
    case 'completed': return 'bg-emerald-100 text-emerald-700'
    case 'error': return 'bg-red-100 text-red-700'
    case 'clarifying':
    case 'retrieving':
    case 'generating':
      return 'bg-primary-100 text-primary-700'
    default: return 'bg-slate-100 text-slate-600'
  }
}

onMounted(fetchList)
defineExpose({ refresh: fetchList })
</script>

<template>
  <div class="h-full flex flex-col bg-slate-50">
    <!-- 顶部栏 -->
    <div class="h-12 flex items-center px-5 border-b border-slate-200 bg-white flex-shrink-0">
      <span class="text-slate-700 font-medium">📜 我的生成</span>
      <span class="ml-2 text-xs text-slate-400">共 {{ sessions.length }} 条</span>
      <button @click="fetchList" class="ml-auto text-xs text-slate-500 hover:text-primary-600 transition-colors">
        🔄 刷新
      </button>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 overflow-y-auto light-scroll">
      <!-- 加载 -->
      <div v-if="loading" class="h-full flex items-center justify-center text-slate-400 text-sm">加载中...</div>

      <!-- 错误 -->
      <div v-else-if="errorMsg" class="h-full flex items-center justify-center">
        <div class="text-center">
          <div class="text-red-400 text-4xl mb-2">😵</div>
          <div class="text-slate-500 text-sm">{{ errorMsg }}</div>
          <button @click="fetchList" class="mt-3 text-xs text-primary-600 hover:underline">重试</button>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="sessions.length === 0" class="h-full flex items-center justify-center">
        <div class="text-center">
          <div class="text-5xl mb-3">📭</div>
          <div class="text-slate-500 text-sm">还没有生成记录，去生成一个吧～</div>
        </div>
      </div>

      <!-- 列表 -->
      <div v-else class="max-w-4xl mx-auto py-3 space-y-2 px-5">
        <div
          v-for="s in sessions"
          :key="s.id"
          :class="[
            'bg-white rounded-lg border transition-all cursor-pointer overflow-hidden',
            expandedId === s.id ? 'border-primary-300 shadow-sm' : 'border-slate-200 hover:border-slate-300',
          ]"
          @click="toggleDetail(s.id)"
        >
          <!-- 列表行 -->
          <div class="flex items-center gap-3 px-4 py-3">
            <div class="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-base">
              {{ s.artifact_type === 'component' ? '🧩' : '🤖' }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-xs px-1.5 py-0.5 rounded font-medium" :class="statusColor(s.status)">
                  {{ s.status === 'completed' ? '✅ 完成' : s.status === 'error' ? '❌ 失败' : s.status === 'generating' ? '⚙️ 生成中' : s.status }}
                </span>
                <span class="text-xs text-slate-400">v{{ s.iteration || 1 }}</span>
                <span v-if="s.framework" class="text-xs text-slate-400">{{ s.framework.toUpperCase() }}</span>
                <span v-if="s.skill_name" class="text-xs text-slate-400">{{ s.skill_name }}</span>
              </div>
              <div class="text-sm text-slate-700 truncate mt-0.5">{{ s.requirement }}</div>
              <div class="text-[11px] text-slate-400 mt-0.5">{{ formatTime(s.updated_at) }} · {{ s.file_count || 0 }} 个文件</div>
            </div>
            <button
              @click.stop="deleteSession(s.id)"
              class="text-slate-300 hover:text-red-500 transition-colors p-1"
              title="删除"
            >
              🗑️
            </button>
          </div>

          <!-- 展开详情 -->
          <div v-if="expandedId === s.id" class="border-t border-slate-100 bg-slate-50/50">
            <div v-if="detailLoading" class="px-4 py-4 text-xs text-slate-400">加载详情...</div>
            <div v-else-if="detail" class="p-4 space-y-3">
              <!-- 文件版本 -->
              <div v-if="detail.files?.length" class="space-y-2">
                <div class="text-xs text-slate-500 font-medium">文件（{{ detail.files.length }} 个版本）</div>
                <div
                  v-for="f in detail.files"
                  :key="f.id"
                  class="bg-white border border-slate-200 rounded-lg overflow-hidden"
                >
                  <div class="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs">
                    <span class="font-mono text-slate-700">{{ f.file_path }}</span>
                    <span class="text-slate-400">· v{{ f.iteration }}</span>
                    <span v-if="f.is_current" class="text-emerald-600 font-medium">current</span>
                    <button
                      @click.stop="() => downloadFile(f)"
                      class="ml-auto text-slate-400 hover:text-primary-600 transition-colors"
                    >
                      ⬇️
                    </button>
                  </div>
                  <pre class="p-3 text-xs text-slate-700 overflow-x-auto light-scroll max-h-64">{{ f.content }}</pre>
                </div>
              </div>
              <div v-else class="text-xs text-slate-400 italic">无文件产出</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
