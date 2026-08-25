<script setup lang="ts">
import { useAgent } from '../composables/useAgent'

const {
  state,
  status,
  isRunning,
  phaseHistory,
  toolCalls,
  finalAnswer,
  error,
  runAgent,
  pauseAgent,
  resumeAgent,
  reset,
} = useAgent()

const input = ref('')
const threadId = ref('')

const statusClass = computed(() => {
  switch (status.value) {
    case 'idle': return 'bg-slate-100 text-slate-600'
    case 'running': return 'bg-blue-100 text-blue-600'
    case 'paused': return 'bg-amber-100 text-amber-600'
    case 'completed': return 'bg-emerald-100 text-emerald-600'
    case 'failed': return 'bg-red-100 text-red-600'
    default: return 'bg-slate-100 text-slate-600'
  }
})

const phaseLabel = computed(() => {
  if (!state.value) return '等待输入'
  const phaseMap: Record<string, string> = {
    idle: '空闲',
    think: '思考中',
    call_tools: '调用工具',
    observe: '观察结果',
    answer: '生成回答',
    completed: '已完成',
    failed: '失败',
  }
  return phaseMap[state.value.phase] || state.value.phase
})

const handleRun = async () => {
  if (!input.value.trim() || isRunning.value) return

  const messages = [{ role: 'user', content: input.value }]
  const options: { threadId?: string } = {}
  if (threadId.value.trim()) {
    options.threadId = threadId.value.trim()
  }

  await runAgent(messages, options)
}

const handleReset = () => {
  input.value = ''
  threadId.value = ''
  reset()
}

const phaseIcon = (phase: string): string => {
  const icons: Record<string, string> = {
    think: '🤔',
    call_tools: '🔧',
    observe: '👀',
    answer: '💡',
    completed: '✅',
    failed: '❌',
  }
  return icons[phase] || '•'
}

const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto py-8 px-8">
      <header class="mb-6">
        <h1 class="text-2xl font-bold text-slate-800">Agent 调试</h1>
        <p class="text-sm text-slate-500 mt-1">测试 AI Agent 的多步推理和工具调用能力</p>
      </header>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-1 space-y-4">
          <div class="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 class="text-sm font-semibold text-slate-800 mb-3">运行控制</h3>
            
            <div class="mb-3">
              <label class="text-xs text-slate-500 block mb-1">会话 ID（可选）</label>
              <input
                v-model="threadId"
                type="text"
                placeholder="留空自动生成"
                class="w-full text-sm bg-slate-50 rounded-lg px-3 py-2 outline-none border border-slate-200 focus:border-brand-400"
              />
            </div>

            <div class="mb-3">
              <label class="text-xs text-slate-500 block mb-1">状态</label>
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-1 rounded-full text-xs font-medium" :class="statusClass">
                  {{ status }}
                </span>
                <span v-if="state" class="text-xs text-slate-500">{{ phaseLabel }}</span>
              </div>
            </div>

            <button
              class="w-full px-4 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors mb-2 disabled:opacity-50"
              :disabled="!input.trim() || isRunning"
              @click="handleRun"
            >
              {{ isRunning ? '运行中...' : '▶️ 运行 Agent' }}
            </button>

            <div class="flex gap-2">
              <button
                v-if="state?.status === 'running'"
                class="flex-1 px-3 py-2 bg-amber-50 text-amber-600 rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors"
                @click="state && pauseAgent(state.thread_id)"
              >⏸️ 暂停</button>
              <button
                v-if="state?.status === 'paused'"
                class="flex-1 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
                @click="state && resumeAgent(state.thread_id)"
              >▶️ 恢复</button>
              <button
                class="flex-1 px-3 py-2 bg-slate-50 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-100 transition-colors"
                @click="handleReset"
              >🔄 重置</button>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 class="text-sm font-semibold text-slate-800 mb-3">阶段历史</h3>
            <div v-if="phaseHistory.length === 0" class="text-xs text-slate-400 text-center py-4">
              暂无阶段记录
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="(phase, idx) in phaseHistory"
                :key="idx"
                class="flex items-center gap-2 text-xs"
              >
                <span class="text-lg">{{ phaseIcon(phase.phase) }}</span>
                <div class="flex-1 min-w-0">
                  <span class="font-medium text-slate-700">{{ phase.phase }}</span>
                  <p v-if="phase.message" class="text-slate-500 truncate">{{ phase.message }}</p>
                </div>
                <span class="text-slate-400 text-[10px]">{{ formatTime(phase.timestamp) }}</span>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 class="text-sm font-semibold text-slate-800 mb-3">工具调用</h3>
            <div v-if="toolCalls.length === 0" class="text-xs text-slate-400 text-center py-4">
              暂无工具调用
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="(call, idx) in toolCalls"
                :key="idx"
                class="p-2 bg-slate-50 rounded-lg text-xs"
              >
                <div class="flex items-center justify-between mb-1">
                  <span class="font-medium text-slate-700">{{ call.name }}</span>
                  <span
                    class="px-1.5 py-0.5 rounded text-[10px]"
                    :class="call.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'"
                  >{{ call.status }}</span>
                </div>
                <p class="text-slate-500 truncate">Args: {{ JSON.stringify(call.args) }}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="lg:col-span-2 space-y-4">
          <div class="bg-white rounded-2xl border border-slate-200 p-5">
            <label class="text-sm font-medium text-slate-700 block mb-2">输入指令</label>
            <textarea
              v-model="input"
              rows="4"
              placeholder="告诉 Agent 你想做什么，例如：帮我查询今天的日期，并生成一份周报模板"
              class="w-full text-sm bg-slate-50 rounded-lg px-4 py-3 outline-none border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition resize-none"
            ></textarea>
          </div>

          <div v-if="error" class="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            ❌ {{ error }}
          </div>

          <div class="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 class="text-sm font-semibold text-slate-800 mb-3">Agent 回答</h3>
            <div v-if="!finalAnswer && !isRunning" class="text-sm text-slate-400 text-center py-8">
              <div class="text-4xl mb-3">🤖</div>
              <p>运行 Agent 后，回答将在这里显示</p>
            </div>
            <div v-else class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
              {{ finalAnswer }}
              <span v-if="isRunning" class="inline-block w-0.5 h-4 bg-brand-500 animate-pulse ml-0.5"></span>
            </div>
          </div>

          <div v-if="state" class="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 class="text-sm font-semibold text-slate-800 mb-3">状态详情</h3>
            <pre class="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg overflow-auto">{{ JSON.stringify(state, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
