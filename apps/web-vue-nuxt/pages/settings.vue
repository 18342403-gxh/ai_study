<script setup lang="ts">
const { clearCurrentSession, sessions, activeSessionId, deleteSession, loadOrCreateSession } = useChat()

const config = useRuntimeConfig()

const model = ref('glm-4-flash')
const apiEndpoint = ref('')
const apiKey = ref('')
const isSaving = ref(false)

onMounted(() => {
  loadOrCreateSession()
  apiEndpoint.value = config.public.bffUrl || 'http://localhost:3001'
  try {
    if (typeof localStorage !== 'undefined') {
      const savedKey = localStorage.getItem('ai-generator-api-key')
      if (savedKey) apiKey.value = savedKey
      const savedModel = localStorage.getItem('ai-generator-model')
      if (savedModel) model.value = savedModel
    }
  } catch {}
})

const saveConfig = async () => {
  isSaving.value = true
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ai-generator-api-key', apiKey.value)
      localStorage.setItem('ai-generator-model', model.value)
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 300))
  isSaving.value = false
}

const clearAllData = () => {
  if (confirm('确定要清除所有数据吗？包括所有历史会话。')) {
    try {
      if (typeof localStorage !== 'undefined') {
        const allKeys = Object.keys(localStorage).filter((k) => k.startsWith('ai-generator-'))
        allKeys.forEach((k) => localStorage.removeItem(k))
      }
    } catch {}
    sessions.value.forEach((s) => {
      deleteSession(s.id)
    })
    alert('已清除所有数据')
  }
}

const aboutItems = [
  { label: '版本号', value: '0.1.0' },
  { label: '技术栈', value: 'Nuxt 3 + Vue 3 + Tailwind CSS' },
  { label: 'AI 模型', value: 'glm-4-flash (智谱 AI)' },
  { label: '运行模式', value: 'SSR (Server-Side Rendering)' },
  { label: 'BFF 地址', value: config.public.bffUrl || '未配置' },
]
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-3xl mx-auto py-8 px-8">
      <header class="mb-8">
        <h1 class="text-2xl font-bold text-slate-800">设置</h1>
        <p class="text-sm text-slate-500 mt-1">管理你的 AI 组件生成器配置</p>
      </header>

      <div class="space-y-6">
        <!-- AI 配置 -->
        <section class="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div class="px-6 py-4 border-b border-slate-100">
            <h2 class="text-base font-semibold text-slate-800">AI 配置</h2>
            <p class="text-xs text-slate-500 mt-1">配置 AI 接口地址和认证信息</p>
          </div>

          <div class="px-6 py-5 space-y-5">
            <div>
              <label class="text-sm font-medium text-slate-700 block mb-2">
                BFF 服务地址
              </label>
              <input
                v-model="apiEndpoint"
                type="text"
                class="w-full text-sm bg-slate-50 rounded-lg px-4 py-2.5 outline-none border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition"
                placeholder="http://localhost:3001"
              />
              <p class="text-xs text-slate-400 mt-1.5">后端 BFF 代理地址，前端通过此地址转发 AI 请求</p>
            </div>

            <div>
              <label class="text-sm font-medium text-slate-700 block mb-2">
                API Key
                <span class="text-xs text-slate-400 font-normal ml-1">(存储在本地，不会上传)</span>
              </label>
              <input
                v-model="apiKey"
                type="password"
                class="w-full text-sm bg-slate-50 rounded-lg px-4 py-2.5 outline-none border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition font-mono"
                placeholder="输入你的 API Key"
                autocomplete="off"
              />
            </div>

            <div>
              <label class="text-sm font-medium text-slate-700 block mb-2">默认模型</label>
              <div class="flex gap-2">
                <button
                  v-for="m in ['glm-4-flash', 'glm-4-plus', 'glm-4']"
                  :key="m"
                  class="px-4 py-2 rounded-lg text-sm font-medium transition-all border"
                  :class="model === m
                    ? 'bg-brand-500 text-white border-brand-500 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300 hover:text-brand-600'"
                  @click="model = m"
                >{{ m }}</button>
              </div>
            </div>
          </div>

          <div class="px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
            <button
              class="px-6 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isSaving"
              @click="saveConfig"
            >
              {{ isSaving ? '保存中...' : '保存配置' }}
            </button>
          </div>
        </section>

        <!-- 数据管理 -->
        <section class="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div class="px-6 py-4 border-b border-slate-100">
            <h2 class="text-base font-semibold text-slate-800">数据管理</h2>
            <p class="text-xs text-slate-500 mt-1">管理你的会话数据和本地存储</p>
          </div>
          <div class="px-6 py-2 divide-y divide-slate-100">
            <button
              class="w-full py-3 flex items-center justify-between text-left hover:bg-slate-50 rounded-lg px-3 transition-colors group"
              @click="clearCurrentSession"
            >
              <div>
                <span class="text-sm text-slate-700 font-medium">清除当前会话</span>
                <p class="text-xs text-slate-400 mt-0.5">保留其他历史会话</p>
              </div>
              <span class="text-slate-300 group-hover:text-slate-500 transition-colors">›</span>
            </button>
            <button
              class="w-full py-3 flex items-center justify-between text-left hover:bg-red-50 rounded-lg px-3 transition-colors group"
              @click="clearAllData"
            >
              <div>
                <span class="text-sm text-red-500 font-medium">清除所有数据</span>
                <p class="text-xs text-red-300 mt-0.5">删除全部历史会话和配置</p>
              </div>
              <span class="text-slate-300 group-hover:text-red-400 transition-colors">›</span>
            </button>
          </div>
        </section>

        <!-- 关于 -->
        <section class="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div class="px-6 py-4 border-b border-slate-100">
            <h2 class="text-base font-semibold text-slate-800">关于</h2>
          </div>
          <div class="px-6 py-2">
            <div
              v-for="(item, idx) in aboutItems"
              :key="item.label"
              class="py-3 flex items-center justify-between"
              :class="idx < aboutItems.length - 1 ? 'border-b border-slate-100' : ''"
            >
              <span class="text-sm text-slate-500">{{ item.label }}</span>
              <span class="text-sm text-slate-700 font-mono text-xs">{{ item.value }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
