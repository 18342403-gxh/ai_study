<script setup lang="ts">
interface Template {
  id: string
  name: string
  desc: string
  icon: string
  gradient: string
  prompt: string
  tags: string[]
  isServer?: boolean
}

const router = useRouter()
const templates = ref<Template[]>([])
const isLoading = ref(false)
const serverTemplates = ref<Template[]>([])
const error = ref<string | null>(null)

const fallbackTemplates: Template[] = [
  {
    id: 'search',
    name: '搜索框',
    desc: '带防抖、下拉建议的搜索组件',
    icon: '🔍',
    gradient: 'from-brand-400 to-brand-600',
    prompt: '生成一个搜索框组件，支持：1. 输入防抖(300ms) 2. 下拉建议列表 3. 清除按钮 4. 键盘导航支持',
    tags: ['输入', '表单'],
  },
  {
    id: 'card',
    name: '商品卡片',
    desc: '图片、价格、标签一体化卡片',
    icon: '🛍️',
    gradient: 'from-coral-400 to-coral-600',
    prompt: '生成一个商品卡片组件，包含：商品图片、名称、价格(划线原价)、标签、加入购物车按钮、收藏按钮',
    tags: ['展示', '电商'],
  },
  {
    id: 'table',
    name: '数据表格',
    desc: '排序、分页、行选择',
    icon: '📊',
    gradient: 'from-mint-400 to-mint-600',
    prompt: '生成一个数据表格组件，支持：列排序、分页、行多选、空状态、加载状态，使用 TypeScript',
    tags: ['数据', '表格'],
  },
  {
    id: 'form',
    name: '登录表单',
    desc: '完整表单校验流程',
    icon: '📝',
    gradient: 'from-blue-400 to-blue-600',
    prompt: '生成一个登录表单组件，包含：用户名、密码(带显示切换)、验证码、表单实时校验、提交状态',
    tags: ['表单', '校验'],
  },
  {
    id: 'navbar',
    name: '导航栏',
    desc: '响应式顶部导航',
    icon: '🧭',
    gradient: 'from-purple-400 to-purple-600',
    prompt: '生成一个响应式导航栏组件，支持：Logo、菜单项(支持下拉)、移动端汉堡菜单、滚动变色效果',
    tags: ['导航', '响应式'],
  },
  {
    id: 'modal',
    name: '弹窗组件',
    desc: '居中/底部弹出',
    icon: '💬',
    gradient: 'from-amber-400 to-amber-600',
    prompt: '生成一个弹窗组件，支持：居中弹窗、底部弹出、确认/取消按钮、关闭动画、遮罩点击关闭',
    tags: ['弹窗', '交互'],
  },
]

const { createNewSession, sendMessage, loadOrCreateSession } = useChat()

const loadTemplates = async () => {
  isLoading.value = true
  error.value = null

  try {
    const config = useRuntimeConfig()
    const bffUrl = config.public.bffUrl || 'http://localhost:3001'
    const res = await fetch(`${bffUrl}/api/rag/documents`)

    if (res.ok) {
      const documents = await res.json()
      if (Array.isArray(documents) && documents.length > 0) {
        serverTemplates.value = documents.map((doc: { id: string; name: string; chunk_count: number; type: string }) => ({
          id: doc.id,
          name: doc.name.replace(/\.[^.]+$/, ''),
          desc: `${doc.chunk_count || 0} 个分块 · ${doc.type.toUpperCase()}`,
          icon: '📄',
          gradient: 'from-emerald-400 to-emerald-600',
          prompt: `请基于知识库文档"${doc.name}"的内容，回答以下问题。`,
          tags: ['知识库', doc.type],
          isServer: true,
        }))
        templates.value = [...serverTemplates.value, ...fallbackTemplates]
        return
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载模板失败'
  }

  templates.value = fallbackTemplates
}

onMounted(() => {
  loadOrCreateSession()
  loadTemplates()
})

const handleUseTemplate = (prompt: string) => {
  createNewSession()
  sendMessage(prompt)
  router.push('/')
}

const handleUpload = () => {
  router.push('/rag')
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto py-8 px-8">
      <header class="mb-8">
        <h1 class="text-2xl font-bold text-slate-800">模板库</h1>
        <p class="text-sm text-slate-500 mt-1">选择一个模板，让 AI 基于模板快速生成组件</p>
      </header>

      <div class="mb-6 p-5 rounded-2xl bg-gradient-primary text-white">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold mb-1">🚀 快速开始</h2>
            <p class="text-sm opacity-90">选择模板或自由描述你的需求，AI 会为你生成高质量组件代码</p>
          </div>
          <div class="flex gap-2">
            <button
              class="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-medium transition-colors"
              @click="handleUpload"
            >
              上传知识库
            </button>
            <button
              class="px-5 py-2.5 bg-white text-brand-600 rounded-xl text-sm font-medium hover:bg-white/90 transition-colors"
              @click="router.push('/')"
            >
              自由对话 →
            </button>
          </div>
        </div>
      </div>

      <div v-if="isLoading && templates.length === 0" class="flex items-center justify-center py-20">
        <div class="flex items-center gap-3 text-slate-400">
          <svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/>
            <path d="M12 2a10 10 0 0110 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          </svg>
          <span>正在加载模板...</span>
        </div>
      </div>

      <template v-else>
        <div v-if="serverTemplates.length > 0" class="mb-6">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-sm font-semibold text-slate-700">📚 知识库模板</span>
            <span class="text-xs text-slate-400">（从服务端加载）</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              v-for="template in serverTemplates"
              :key="template.id"
              class="group p-5 rounded-xl bg-white border border-emerald-200 hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer"
              @click="handleUseTemplate(template.prompt)"
            >
              <div
                class="w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-xl mb-4"
                :class="template.gradient"
              >
                {{ template.icon }}
              </div>
              <h3 class="text-base font-semibold text-slate-800 mb-1">{{ template.name }}</h3>
              <p class="text-xs text-slate-500 leading-relaxed mb-3">{{ template.desc }}</p>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="tag in template.tags"
                  :key="tag"
                  class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 text-[11px]"
                >{{ tag }}</span>
              </div>
              <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span class="text-xs text-slate-400">基于知识库</span>
                <span class="text-emerald-600 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  使用 →
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="mb-6">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-sm font-semibold text-slate-700">⚡ 内置模板</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <div
              v-for="template in fallbackTemplates"
              :key="template.id"
              class="group p-5 rounded-xl bg-white border border-slate-200 hover:border-brand-300 hover:shadow-md transition-all cursor-pointer"
              @click="handleUseTemplate(template.prompt)"
            >
              <div
                class="w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-xl mb-4"
                :class="template.gradient"
              >
                {{ template.icon }}
              </div>
              <h3 class="text-base font-semibold text-slate-800 mb-1">{{ template.name }}</h3>
              <p class="text-xs text-slate-500 leading-relaxed mb-3">{{ template.desc }}</p>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="tag in template.tags"
                  :key="tag"
                  class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px]"
                >{{ tag }}</span>
              </div>
              <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span class="text-xs text-slate-400">点击使用此模板</span>
                <span class="text-brand-500 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  使用 →
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="p-5 rounded-xl bg-white border border-slate-200">
        <h3 class="text-sm font-semibold text-slate-800 mb-3">💡 使用提示</h3>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-500">
          <div class="flex gap-2">
            <span class="text-brand-500 font-semibold shrink-0">01</span>
            <span>点击模板后会自动创建新对话并发送生成需求</span>
          </div>
          <div class="flex gap-2">
            <span class="text-brand-500 font-semibold shrink-0">02</span>
            <span>可以在对话中继续追问、修改需求细节</span>
          </div>
          <div class="flex gap-2">
            <span class="text-brand-500 font-semibold shrink-0">03</span>
            <span>上传文档到知识库，即可在模板库中使用</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
