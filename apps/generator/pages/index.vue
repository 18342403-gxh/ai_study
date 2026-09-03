<script setup lang="ts">
import { ref, computed } from 'vue'

// ── 文件预览 Tab 切换 ──
const activeFileIdx = ref(0)

// ── 模式切换 ──
type ArtifactType = 'component' | 'skill'
const activeTab = ref<ArtifactType>('component')

const isComponent = computed(() => activeTab.value === 'component')
const isSkill = computed(() => activeTab.value === 'skill')

// ── 表单字段 ──
const requirement = ref('')
const framework = ref<'vue' | 'react'>('vue')
const skillName = ref('')
const scriptLang = ref<'ts' | 'py' | ''>('')

// ── 生成状态 ──
const isGenerating = ref(false)
const phases = ref<Array<{ node: string; status: 'pending' | 'running' | 'done' | 'error'; message?: string }>>([])
const currentFiles = ref<Array<{ path: string; content: string; language: string }>>([])
const currentPhase = ref('idle')
const errorMsg = ref('')
const stateId = ref('')
const showIterateInput = ref(false)
const iterateFeedback = ref('')

// ── 提交参数（根据 tab 组装） ──
const buildPayload = () => {
  if (activeTab.value === 'component') {
    return {
      requirement: requirement.value,
      artifactType: 'component' as const,
      framework: framework.value,
    }
  }
  return {
    requirement: requirement.value,
    artifactType: 'skill' as const,
    skillName: skillName.value,
    scriptLang: scriptLang.value || undefined,
  }
}

const canSubmit = computed(() => {
  if (!requirement.value.trim()) return false
  if (activeTab.value === 'skill' && !skillName.value.trim()) return false
  return !isGenerating.value
})

// ── SSE 解析 ──
const runGenerator = async () => {
  if (!canSubmit.value) return

  isGenerating.value = true
  showIterateInput.value = false
  errorMsg.value = ''
  currentFiles.value = []
  phases.value = []
  stateId.value = ''

  const { bffUrl } = useRuntimeConfig().public
  const payload = buildPayload()

  try {
    const res = await fetch(`${bffUrl}/api/generator/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok || !res.body) {
      errorMsg.value = `HTTP ${res.status} 启动失败`
      isGenerating.value = false
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const json = trimmed.slice(6)
        if (!json) continue

        try {
          const event = JSON.parse(json)
          handleEvent(event)
        } catch {
          // SSE 可能收到不完整的 JSON，忽略
        }
      }
    }
  } catch (e) {
    errorMsg.value = (e as Error).message
  } finally {
    isGenerating.value = false
  }
}

const handleEvent = (event: any) => {
  // 顶层 type: done / error / event
  if (event.type === 'done') {
    return
  }
  if (event.type === 'error') {
    errorMsg.value = event.message
    return
  }

  // event 事件：带 event + node + data
  const { event: kind, node, data } = event

  if (kind === 'on_chain_start' && node) {
    currentPhase.value = node
    phases.value.push({ node, status: 'running', message: (data as any)?.message })
  }

  if (kind === 'on_chain_end' && node) {
    const p = phases.value.find((x) => x.node === node)
    if (p) p.status = 'done'

    // generate 节点结束 → 拿到文件列表
    if (node === 'generate' && (data as any)?.files) {
      currentFiles.value = (data as any).files
    }
    if (node === 'preview' && (data as any)?.files) {
      // Skill 模式 previewInfo 里带 files
      if (!currentFiles.value.length) currentFiles.value = (data as any).files
    }
  }

  if (kind === 'on_delta' && typeof data === 'string') {
    // 流式代码片段（暂存，generate 完成后才完整解析）
  }

  if (kind === 'on_error') {
    errorMsg.value = (data as any)?.message || '生成失败'
    const last = phases.value[phases.value.length - 1]
    if (last) last.status = 'error'
  }

  if (kind === 'on_iteration_complete' && data) {
    stateId.value = (data as any).stateId
    showIterateInput.value = true
    if ((data as any).result?.files) {
      currentFiles.value = (data as any).result.files
    }
  }
}

// ── 迭代 ──
const runIterate = async () => {
  if (!stateId.value || !iterateFeedback.value.trim()) return
  isGenerating.value = true
  showIterateInput.value = false
  errorMsg.value = ''

  const { bffUrl } = useRuntimeConfig().public

  try {
    const res = await fetch(`${bffUrl}/api/generator/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateId: stateId.value, feedback: iterateFeedback.value }),
    })

    if (!res.ok || !res.body) {
      errorMsg.value = `HTTP ${res.status}`
      isGenerating.value = false
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        try {
          const event = JSON.parse(trimmed.slice(6))
          if (event?.result?.files) currentFiles.value = event.result.files
          if (event?.type === 'error') errorMsg.value = event.message
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    errorMsg.value = (e as Error).message
  } finally {
    isGenerating.value = false
    iterateFeedback.value = ''
  }
}

// ── 下载 ──
const downloadFile = (f: { path: string; content: string }) => {
  const blob = new Blob([f.content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // 只取文件名部分
  a.download = f.path.split('/').pop() || 'file.txt'
  a.click()
  URL.revokeObjectURL(url)
}

const downloadAll = () => {
  currentFiles.value.forEach((f) => downloadFile(f))
}

const nodeLabel = (n: string) => ({
  clarify: '需求细化',
  retrieve: '检索参考',
  generate: '生成代码',
  preview: '预览检查',
  iterate: '迭代优化',
}[n] || n)
</script>

<template>
  <div class="h-full flex">
    <!-- 左侧：输入 + 进度 -->
    <div class="w-[360px] border-r bg-white flex flex-col flex-shrink-0">
      <!-- 模式切换 Tab -->
      <div class="flex border-b">
        <button
          @click="activeTab = 'component'"
          :class="[
            'flex-1 py-3 text-sm font-medium transition-colors',
            isComponent ? 'text-primary-600 border-b-2 border-primary-500 bg-primary-50/50' : 'text-slate-500 hover:text-slate-700',
          ]"
        >
          🧩 组件生成
        </button>
        <button
          @click="activeTab = 'skill'"
          :class="[
            'flex-1 py-3 text-sm font-medium transition-colors',
            isSkill ? 'text-primary-600 border-b-2 border-primary-500 bg-primary-50/50' : 'text-slate-500 hover:text-slate-700',
          ]"
        >
          🤖 Skill 生成
        </button>
      </div>

      <!-- 表单区 -->
      <div class="flex-1 p-4 overflow-y-auto">
        <!-- Component 专属 -->
        <div v-if="isComponent" class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-slate-600 mb-1.5">框架</label>
            <div class="flex gap-2">
              <button
                v-for="f in ['vue', 'react'] as const"
                :key="f"
                @click="framework = f"
                :class="[
                  'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                  framework === f
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
                ]"
              >
                {{ f === 'vue' ? 'Vue 3' : 'React 18' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Skill 专属 -->
        <div v-if="isSkill" class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-slate-600 mb-1.5">Skill 名称</label>
            <input
              v-model="skillName"
              placeholder="如：refactor-logger"
              class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-600 mb-1.5">脚本语言（可选）</label>
            <div class="flex gap-2">
              <button
                v-for="lang in [{ v: '', label: '无' }, { v: 'ts', label: 'TypeScript' }, { v: 'py', label: 'Python' }]"
                :key="lang.v"
                @click="scriptLang = lang.v as any"
                :class="[
                  'px-3 py-1.5 rounded text-xs font-medium border transition-colors',
                  scriptLang === lang.v
                    ? 'bg-primary-500 text-white border-primary-500'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
                ]"
              >
                {{ lang.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- 共用：需求描述 -->
        <div class="mt-4">
          <label class="block text-xs font-medium text-slate-600 mb-1.5">功能描述</label>
          <textarea
            v-model="requirement"
            :placeholder="isComponent
              ? '描述你想要的组件，如：带搜索和分页的数据表格卡片...'
              : '描述 Skill 要做什么，如：批量把 console.log 替换成项目的 logger...'"
            class="w-full h-32 px-3 py-2 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
          />
        </div>

        <!-- 生成按钮 -->
        <button
          @click="runGenerator"
          :disabled="!canSubmit"
          :class="[
            'w-full py-3 rounded-lg text-sm font-semibold transition-colors mt-2',
            canSubmit
              ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white hover:from-primary-600 hover:to-primary-700'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed',
          ]"
        >
          {{ isGenerating ? '⚙️ 生成中...' : `✨ 生成 ${isComponent ? '组件' : 'Skill'}` }}
        </button>

        <!-- 错误提示 -->
        <div v-if="errorMsg" class="mt-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
          {{ errorMsg }}
        </div>

        <!-- 进度时间线 -->
        <div v-if="phases.length" class="mt-5">
          <div class="text-xs font-medium text-slate-500 mb-2">执行进度</div>
          <div class="space-y-2">
            <div
              v-for="p in phases"
              :key="p.node"
              class="flex items-center gap-2 text-xs"
            >
              <span v-if="p.status === 'running'" class="animate-pulse">⏳</span>
              <span v-else-if="p.status === 'done'">✅</span>
              <span v-else-if="p.status === 'error'">❌</span>
              <span v-else>⬜</span>
              <span :class="p.status === 'running' ? 'text-primary-600 font-medium' : 'text-slate-600'">
                {{ nodeLabel(p.node) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 迭代反馈区 -->
      <div v-if="showIterateInput && !isGenerating" class="border-t p-3 bg-slate-50">
        <div class="text-xs text-slate-600 mb-2">对结果不满意？描述需要调整的地方：</div>
        <textarea
          v-model="iterateFeedback"
          placeholder="如：按钮要居中、加一个 loading 状态..."
          class="w-full h-20 px-2.5 py-1.5 border rounded text-xs resize-none"
        />
        <button
          @click="runIterate"
          :disabled="!iterateFeedback.trim()"
          class="mt-2 w-full py-2 rounded text-xs font-medium bg-primary-500 text-white disabled:opacity-50"
        >
          🔄 重新生成
        </button>
      </div>
    </div>

    <!-- 右侧：文件预览 -->
    <div class="flex-1 flex flex-col bg-slate-50">
      <!-- 顶部操作栏 -->
      <div class="h-11 border-b bg-white flex items-center px-4 gap-2 flex-shrink-0">
        <div class="text-sm font-medium text-slate-700">
          {{ isComponent ? '组件代码' : 'Skill 包文件' }}
        </div>
        <div v-if="currentFiles.length" class="text-xs text-slate-400 ml-2">
          {{ currentFiles.length }} 个文件
        </div>
        <div class="ml-auto flex gap-2">
          <button
            v-if="currentFiles.length > 1"
            @click="downloadAll"
            class="text-xs px-3 py-1.5 border rounded hover:bg-slate-50"
          >
            📦 下载全部
          </button>
        </div>
      </div>

      <!-- 文件列表 + 预览 -->
      <div v-if="currentFiles.length" class="flex-1 flex overflow-hidden">
        <!-- 多文件 Tab -->
        <div v-if="currentFiles.length > 1" class="w-40 border-r bg-white flex-shrink-0 overflow-y-auto p-1.5">
          <div
            v-for="(f, i) in currentFiles"
            :key="i"
            @click="activeFileIdx = i"
            :class="[
              'px-2 py-1.5 rounded text-xs cursor-pointer mb-0.5 truncate transition-colors',
              activeFileIdx === i ? 'bg-primary-100 text-primary-700 font-medium' : 'text-slate-600 hover:bg-slate-100',
            ]"
            :title="f.path"
          >
            {{ f.path.split('/').pop() }}
          </div>
        </div>

        <!-- 代码预览 -->
        <div class="flex-1 overflow-auto">
          <div class="p-3 flex items-center justify-between text-xs text-slate-400 border-b bg-white sticky top-0 z-10">
            <span>{{ currentFiles[activeFileIdx]?.path }}</span>
            <button
              @click="downloadFile(currentFiles[activeFileIdx])"
              class="px-2 py-1 border rounded hover:bg-slate-50 text-slate-600"
            >
              💾 下载
            </button>
          </div>
          <pre class="p-4 text-xs leading-relaxed"><code>{{ currentFiles[activeFileIdx]?.content }}</code></pre>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="flex-1 flex items-center justify-center text-slate-400 text-sm">
        {{ isGenerating ? '正在生成，请稍候...' : '描述你的需求，开始生成' }}
      </div>
    </div>
  </div>
</template>
