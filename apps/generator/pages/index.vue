<script setup lang="ts">
import { ref, computed, nextTick, inject } from 'vue'

// ── 模式切换：从 layout inject 进来 ──
type ArtifactType = 'component' | 'skill' | 'history'
const activeTab = inject<{ value: ArtifactType }>('activeTab', ref<ArtifactType>('component'))
const isComponent = computed(() => activeTab.value === 'component')
const isHistory = computed(() => activeTab.value === 'history')

// ── 表单字段 ──
const input = ref('')                      // 统一输入框（首次 + 迭代共用）
const framework = ref<'vue' | 'react'>('vue')
const skillName = ref('')
const scriptLang = ref<'ts' | 'py' | ''>('')

// ── 生成状态 ──
type FileItem = { path: string; content: string; language?: string }
const isGenerating = ref(false)
const phases = ref<Array<{ node: string; status: 'pending' | 'running' | 'done' | 'error'; message?: string }>>([])
const currentFiles = ref<FileItem[]>([])
const activeFileIdx = ref(0)
const errorMsg = ref('')
const stateId = ref('')
const chatHistory = ref<Array<{ role: 'user' | 'ai'; content: string; files?: FileItem[]; phases?: typeof phases.value }>>([])
const scrollRef = ref<HTMLElement | null>(null)

const hasResult = computed(() => chatHistory.value.some((m) => m.role === 'ai'))
const canIterate = computed(() => !!stateId.value && !isGenerating.value)

// ── 自动滚动到底部 ──
const scrollToBottom = async () => {
  await nextTick()
  if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
}

// ── 提交参数 ──
const buildPayload = () => {
  if (activeTab.value === 'component') {
    return {
      requirement: input.value,
      artifactType: 'component' as const,
      framework: framework.value,
    }
  }
  return {
    requirement: input.value,
    artifactType: 'skill' as const,
    skillName: skillName.value,
    scriptLang: scriptLang.value || undefined,
  }
}

const canSubmit = computed(() => {
  if (!input.value.trim()) return false
  if (activeTab.value === 'skill' && !skillName.value.trim()) return false
  return !isGenerating.value
})

// ── 主提交：根据场景自动分流 ──
const handleSubmit = async () => {
  if (canIterate.value) runIterate()
  else runGenerator()
}

// ── SSE 解析 ──
const runGenerator = async () => {
  if (!canSubmit.value) return

  isGenerating.value = true
  errorMsg.value = ''
  currentFiles.value = []
  phases.value = []
  stateId.value = ''

  chatHistory.value.push({ role: 'user', content: input.value })

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
      chatHistory.value.push({ role: 'ai', content: `❌ ${errorMsg.value}` })
      scrollToBottom()
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
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    errorMsg.value = (e as Error).message
    chatHistory.value.push({ role: 'ai', content: `❌ ${errorMsg.value}` })
  } finally {
    isGenerating.value = false
    input.value = ''   // 提交后清输入

    chatHistory.value.push({
      role: 'ai',
      content: errorMsg.value ? `生成失败：${errorMsg.value}` : '✅ 生成完成，以下是产出文件：',
      files: currentFiles.value.length ? currentFiles.value : undefined,
      phases: phases.value,
    })

    scrollToBottom()
  }
}

const handleEvent = (event: any) => {
  if (event.type === 'done') return
  if (event.type === 'error') {
    errorMsg.value = event.message
    return
  }

  const { event: kind, node, data } = event

  if (kind === 'on_chain_start' && node) {
    const exists = phases.value.find((p) => p.node === node)
    if (!exists) {
      phases.value.push({ node, status: 'running', message: (data as any)?.message })
    } else {
      exists.status = 'running'
    }
  }

  if (kind === 'on_chain_end' && node) {
    const p = phases.value.find((x) => x.node === node)
    if (p) p.status = 'done'

    if (node === 'generate' && (data as any)?.files) {
      currentFiles.value = (data as any).files
    }
    if (node === 'preview' && (data as any)?.files && !currentFiles.value.length) {
      currentFiles.value = (data as any).files
    }
  }

  if (kind === 'on_error') {
    errorMsg.value = (data as any)?.message || '生成失败'
    const last = phases.value[phases.value.length - 1]
    if (last) last.status = 'error'
  }

  if (kind === 'on_iteration_complete' && data) {
    stateId.value = (data as any).stateId
    if ((data as any).result?.files) {
      currentFiles.value = (data as any).result.files
    }
  }
}

// ── 迭代（对话修改） ──
const runIterate = async () => {
  if (!stateId.value || !input.value.trim()) return

  const feedback = input.value
  chatHistory.value.push({ role: 'user', content: feedback })

  isGenerating.value = true
  errorMsg.value = ''
  phases.value = []

  const { bffUrl } = useRuntimeConfig().public

  try {
    const res = await fetch(`${bffUrl}/api/generator/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateId: stateId.value, feedback }),
    })

    if (!res.ok || !res.body) {
      errorMsg.value = `HTTP ${res.status}`
      isGenerating.value = false
      chatHistory.value.push({ role: 'ai', content: `❌ ${errorMsg.value}` })
      scrollToBottom()
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
          if (event?.result?.stateId) stateId.value = event.result.stateId
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    errorMsg.value = (e as Error).message
  } finally {
    isGenerating.value = false
    input.value = ''   // 提交后清输入

    chatHistory.value.push({
      role: 'ai',
      content: errorMsg.value ? `修改失败：${errorMsg.value}` : '✅ 已根据反馈更新：',
      files: currentFiles.value.length ? currentFiles.value : undefined,
      phases: phases.value,
    })

    scrollToBottom()
  }
}

// ── 下载 ──
const downloadFile = (f: { path: string; content: string }) => {
  const blob = new Blob([f.content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = f.path.split('/').pop() || 'file.txt'
  a.click()
  URL.revokeObjectURL(url)
}

const downloadAllFiles = (files: Array<{ path: string; content: string }>) => {
  files.forEach((f) => downloadFile(f))
}

const nodeLabel = (n: string) => ({
  clarify: '需求细化',
  retrieve: '检索参考',
  generate: '生成代码',
  preview: '预览检查',
  iterate: '迭代优化',
}[n] || n)

const startNewChat = () => {
  chatHistory.value = []
  currentFiles.value = []
  phases.value = []
  stateId.value = ''
  errorMsg.value = ''
  input.value = ''
  activeFileIdx.value = 0
}
</script>

<template>
  <!-- ═══════════════ History 面板 ═══════════════ -->
  <div v-if="isHistory" class="h-full flex flex-col bg-white">
    <HistoryPanel />
  </div>

  <!-- ═══════════════ 生成面板（组件 + Skill 共用） ═══════════════ -->
  <div v-else class="h-full flex flex-col bg-white">
    <!-- ═══════════════ 上方：浅色显示区 ═══════════════ -->
    <div class="flex-1 bg-slate-50 flex flex-col overflow-hidden">
      <!-- 顶部工具栏 -->
      <div class="h-11 flex items-center px-4 border-b border-slate-200 bg-white flex-shrink-0">
        <div class="flex items-center gap-2 text-xs text-slate-500">
          <span class="w-2 h-2 rounded-full bg-primary-500"></span>
          <span>{{ isComponent ? '🧩 组件生成器' : '🤖 Skill 生成器' }}</span>
          <span v-if="isGenerating" class="text-primary-500 animate-pulse">· 生成中</span>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <button
            v-if="hasResult"
            @click="startNewChat"
            class="text-xs px-2.5 py-1 rounded text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            + 新对话
          </button>
        </div>
      </div>

      <!-- 对话历史滚动区 -->
      <div ref="scrollRef" class="flex-1 overflow-y-auto light-scroll px-6 py-5">
        <!-- 空状态 -->
        <div v-if="chatHistory.length === 0 && !isGenerating" class="h-full flex flex-col items-center justify-center text-center">
          <div class="text-5xl mb-4">{{ isComponent ? '🧩' : '🤖' }}</div>
          <div class="text-slate-700 font-medium text-lg mb-1">
            AI {{ isComponent ? '组件' : 'Skill' }} 生成器
          </div>
          <div class="text-slate-500 text-sm max-w-md">
            {{ isComponent
              ? '描述你想要的组件，比如「带搜索和分页的商品列表卡片」'
              : '描述 Skill 要做什么，比如「批量把 console.log 替换成项目的 logger」' }}
          </div>
          <div class="mt-6 flex gap-2">
            <div v-for="tag in (isComponent ? ['数据表格', '弹窗组件', '表单'] : ['代码重构', '批量格式化', '文档生成'])" :key="tag"
              class="px-3 py-1.5 rounded-full text-xs bg-white text-slate-600 border border-slate-200 hover:border-primary-500 hover:text-primary-600 cursor-pointer transition-colors"
              @click="input = tag">
              {{ tag }}
            </div>
          </div>
        </div>

        <!-- 对话消息 -->
        <div v-else class="max-w-3xl mx-auto space-y-5">
          <div v-for="(msg, idx) in chatHistory" :key="idx" class="flex gap-3" :class="msg.role === 'user' ? 'flex-row-reverse' : ''">
            <!-- 头像 -->
            <div
              :class="[
                'w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0',
                msg.role === 'user'
                  ? 'bg-gradient-to-br from-primary-400 to-primary-600 text-white'
                  : 'bg-slate-200 text-slate-600',
              ]"
            >
              {{ msg.role === 'user' ? '你' : 'AI' }}
            </div>

            <!-- 内容 -->
            <div class="min-w-0 max-w-[75%]">
              <!-- 文本气泡 -->
              <div
                :class="[
                  'px-4 py-2.5 text-sm leading-relaxed mb-2',
                  msg.role === 'user' ? 'bubble-user' : 'bubble-ai',
                ]"
              >
                {{ msg.content }}
              </div>

              <!-- 进度时间线 -->
              <div v-if="msg.phases?.length" class="mb-2 pl-2">
                <div class="space-y-1">
                  <div v-for="p in msg.phases" :key="p.node" class="flex items-center gap-2 text-xs">
                    <span v-if="p.status === 'running'" class="pulse-glow text-primary-500">⏳</span>
                    <span v-else-if="p.status === 'done'" class="text-emerald-500">✅</span>
                    <span v-else-if="p.status === 'error'" class="text-red-500">❌</span>
                    <span :class="p.status === 'running' ? 'text-primary-600 font-medium' : 'text-slate-500'">
                      {{ nodeLabel(p.node) }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- 文件预览 — 气泡内部延伸 -->
              <div v-if="msg.files?.length" class="space-y-2 mt-2">
                <div class="flex items-center gap-2 text-xs text-slate-500">
                  <span>📎 {{ msg.files.length }} 个文件</span>
                  <button
                    @click="downloadAllFiles(msg.files)"
                    class="ml-auto px-2.5 py-1 rounded border border-slate-300 text-slate-500 hover:text-slate-700 hover:border-slate-400 transition-colors bg-white"
                  >
                    📦 全部下载
                  </button>
                </div>

                <!-- Tab 栏（仅多文件时显示） -->
                <div v-if="msg.files.length > 1" class="flex gap-0.5 px-1 py-1 border-b border-slate-200">
                  <button
                    v-for="(f, fidx) in msg.files"
                    :key="fidx"
                    @click="activeFileIdx = fidx; currentFiles = msg.files!"
                    :class="[
                      'px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors',
                      activeFileIdx === fidx
                        ? 'bg-primary-100 text-primary-700 font-medium'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
                    ]"
                  >
                    {{ f.path.split('/').pop() }}
                  </button>
                </div>

                <!-- 代码区域：极淡灰底，跟气泡白形成轻微区分，但不是独立卡片 -->
                <pre class="code-block text-slate-800 bg-slate-50 p-3 rounded-lg overflow-x-auto light-scroll">{{ msg.files[activeFileIdx]?.content }}</pre>
              </div>
            </div>
          </div>

          <!-- 正在生成中 -->
          <div v-if="isGenerating && chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user'" class="flex gap-3">
            <div class="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center text-sm text-slate-600">AI</div>
            <div class="bubble-ai px-4 py-2.5 text-sm">
              <span class="inline-flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce" style="animation-delay: 0ms"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce" style="animation-delay: 150ms"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce" style="animation-delay: 300ms"></span>
                <span class="ml-2 text-slate-500">AI 正在思考...</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════ 下方：输入区 ═══════════════ -->
    <div class="bg-white border-t border-slate-200 flex-shrink-0">
      <div class="max-w-4xl mx-auto px-6 py-4">
        <!-- 顶部选项栏 -->
        <div class="flex items-center gap-3 mb-3 text-xs">
          <template v-if="isComponent">
            <span class="text-slate-500 font-medium">框架：</span>
            <div class="flex gap-1.5">
              <button
                v-for="f in ['vue', 'react'] as const"
                :key="f"
                @click="framework = f"
                :class="[
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  framework === f
                    ? 'bg-primary-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                ]"
              >
                {{ f === 'vue' ? 'Vue 3' : 'React 18' }}
              </button>
            </div>
          </template>

          <template v-else>
            <div class="flex items-center gap-2">
              <span class="text-slate-500 font-medium">Skill：</span>
              <input
                v-model="skillName"
                placeholder="名称，如 refactor-logger"
                class="w-40 px-2.5 py-1 rounded-md text-xs border border-slate-200 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-slate-500 font-medium">脚本：</span>
              <div class="flex gap-1">
                <button
                  v-for="lang in [{ v: '', label: '无' }, { v: 'ts', label: 'TS' }, { v: 'py', label: 'PY' }]"
                  :key="lang.v"
                  @click="scriptLang = lang.v as any"
                  :class="[
                    'px-2.5 py-1 rounded text-xs transition-colors',
                    scriptLang === lang.v
                      ? 'bg-primary-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  ]"
                >
                  {{ lang.label }}
                </button>
              </div>
            </div>
          </template>

          <!-- 迭代模式提示（替代"清空"按钮位置） -->
          <div v-if="canIterate" class="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary-50 text-primary-600 text-[11px] font-medium">
            💡 迭代模式
          </div>
          <button
            v-else-if="input"
            @click="input = ''"
            class="ml-auto text-slate-400 hover:text-slate-600 transition-colors"
          >
            清空
          </button>
        </div>

        <!-- 主输入区（首次生成 + 迭代修改 共用） -->
        <div class="relative">
          <textarea
            v-model="input"
            :placeholder="canIterate
              ? '描述你想要的修改，如：按钮要居中、加 loading 状态、改用 Tailwind 类...'
              : (isComponent
                  ? '描述你想要的组件，如：带搜索和分页的数据表格卡片，支持空状态和加载状态...'
                  : '描述 Skill 要做什么，如：批量把项目里的 console.log 替换成统一的 logger 调用...')"
            :disabled="isGenerating"
            class="w-full h-24 px-4 py-3 text-sm border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 disabled:bg-slate-50 disabled:cursor-not-allowed light-scroll"
            @keydown.enter.exact.prevent="handleSubmit"
          />
          <div class="absolute right-3 bottom-3 flex items-center gap-2">
            <button
              @click="handleSubmit"
              :disabled="!canSubmit"
              :class="[
                'px-5 py-2 rounded-lg text-sm font-medium transition-all',
                canSubmit
                  ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white hover:from-primary-600 hover:to-primary-700 shadow-sm hover:shadow'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed',
              ]"
            >
              <span v-if="isGenerating" class="inline-flex items-center gap-1.5">
                <span class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                生成中
              </span>
              <span v-else-if="canIterate" class="inline-flex items-center gap-1.5">
                🔄 发送修改
              </span>
              <span v-else class="inline-flex items-center gap-1.5">
                ✨ 生成 {{ isComponent ? '组件' : 'Skill' }}
              </span>
            </button>
          </div>
        </div>

        <!-- 底部提示 -->
        <div class="mt-2 flex items-center justify-between text-[11px] text-slate-400">
          <div>Enter 发送 · Shift+Enter 换行</div>
          <div v-if="isComponent">{{ framework === 'vue' ? 'Vue 3 + Composition API' : 'React 18 + Hooks' }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
