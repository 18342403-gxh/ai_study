<template>
  <div class="flex flex-col h-full">
    <header
      class="h-14 flex items-center justify-between px-6 border-b border-slate-100 flex-shrink-0"
    >
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold text-slate-800">学习</h2>
        <span class="text-xs text-slate-400">用一句话描述，帮你找 GitHub 项目</span>
      </div>
      <span v-if="total > 0" class="text-xs text-slate-400">
        {{ total.toLocaleString('en-US') }} 个仓库
      </span>
    </header>

    <div class="flex-1 overflow-y-auto light-scroll px-6 py-5">
      <div class="max-w-3xl mx-auto">
        <!-- 搜索区 -->
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <div class="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Compass class="w-4 h-4 text-primary-500" />
            想学什么？描述一下，我来找项目
          </div>
          <textarea
            v-model="query"
            rows="3"
            class="mt-2.5 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-primary-400 focus:outline-none resize-none"
            placeholder="例如：我想找一个 Vue3 的后台管理模板，最好带权限控制和暗色主题"
            @keydown.ctrl.enter.prevent="runSearch"
            @keydown.meta.enter.prevent="runSearch"
          />

          <div class="mt-2.5 flex flex-wrap gap-1.5">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion"
              class="px-2.5 py-1 text-xs rounded-full border border-slate-200 text-slate-500 hover:border-primary-200 hover:text-primary-600 transition-colors"
              @click="useSuggestion(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>

          <div class="mt-3 flex items-center justify-between">
            <p class="text-[11px] text-slate-400">Ctrl + Enter 快速搜索</p>
            <button
              class="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
              :disabled="loading || !query.trim()"
              @click="runSearch"
            >
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <Search v-else class="w-4 h-4" />
              {{ loading ? '搜索中…' : '搜索项目' }}
            </button>
          </div>
        </div>

        <!-- 解析结果 -->
        <div
          v-if="parsed"
          class="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500"
        >
          <span>解析为</span>
          <span
            v-for="keyword in parsed.keywords"
            :key="keyword"
            class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
          >
            {{ keyword }}
          </span>
          <span v-if="parsed.language" class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
            {{ parsed.language }}
          </span>
          <span class="text-slate-400">· {{ sortLabel }}</span>
          <span v-if="parsed.parsedBy === 'rule'" class="text-amber-600">
            （模型解析失败，已按规则解析）
          </span>
        </div>

        <!-- GitHub 超时：专用提示 -->
        <div
          v-if="errorCode === 'GITHUB_TIMEOUT'"
          class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
        >
          <div class="flex items-center gap-2 text-sm font-medium text-amber-700">
            <WifiOff class="w-4 h-4" />
            GitHub 响应超时
          </div>
          <p class="mt-1 text-xs leading-relaxed text-amber-700">
            {{
              errorMessage || 'GitHub 在限定时间内没有返回结果。'
            }}当前未启用备用源，可以稍后再试。
          </p>
          <button
            class="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
            @click="runSearch"
          >
            <RefreshCw class="w-3.5 h-3.5" />
            重新搜索
          </button>
        </div>

        <!-- 限流 / 其他错误 -->
        <div v-else-if="errorCode" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div class="flex items-center gap-2 text-sm font-medium text-rose-700">
            <AlertCircle class="w-4 h-4" />
            {{ errorCode === 'GITHUB_RATE_LIMITED' ? 'GitHub 额度已用尽' : '搜索失败' }}
          </div>
          <p class="mt-1 text-xs leading-relaxed text-rose-700">{{ errorMessage }}</p>
          <button
            class="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-100 transition-colors"
            @click="runSearch"
          >
            <RefreshCw class="w-3.5 h-3.5" />
            重试
          </button>
        </div>

        <!-- 结果列表 -->
        <ul v-if="items.length > 0" class="mt-4 space-y-3">
          <li
            v-for="repo in items"
            :key="repo.id"
            class="rounded-xl border border-slate-200 bg-white p-4 hover:border-primary-200 transition-colors"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <a
                  :href="repo.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="group inline-flex items-center gap-1.5 max-w-full"
                >
                  <span
                    class="text-sm font-medium text-slate-800 group-hover:text-primary-600 truncate"
                  >
                    {{ repo.fullName }}
                  </span>
                  <ExternalLink
                    class="w-3.5 h-3.5 text-slate-300 group-hover:text-primary-500 flex-shrink-0"
                  />
                </a>
                <p class="mt-1 text-xs leading-relaxed text-slate-500 line-clamp-2">
                  {{ repo.description || '暂无简介' }}
                </p>
              </div>
              <img
                v-if="repo.ownerAvatar"
                :src="repo.ownerAvatar"
                :alt="repo.owner"
                class="w-7 h-7 rounded-full flex-shrink-0 bg-slate-100"
                loading="lazy"
              />
            </div>

            <div
              class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400"
            >
              <span class="inline-flex items-center gap-1">
                <Star class="w-3 h-3" />{{ formatCount(repo.stars) }}
              </span>
              <span class="inline-flex items-center gap-1">
                <GitFork class="w-3 h-3" />{{ formatCount(repo.forks) }}
              </span>
              <span v-if="repo.language" class="inline-flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-slate-300"></span>{{ repo.language }}
              </span>
              <span>更新于 {{ repo.updatedAt.slice(0, 10) }}</span>
            </div>

            <div v-if="repo.topics.length > 0" class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="topic in repo.topics.slice(0, 5)"
                :key="topic"
                class="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-100 text-[10px] text-slate-500"
              >
                {{ topic }}
              </span>
            </div>
          </li>
        </ul>

        <!-- 加载更多 -->
        <div v-if="items.length > 0 && hasMore" class="mt-4 flex justify-center">
          <button
            class="inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg border border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-600 disabled:opacity-50 transition-colors"
            :disabled="loadingMore"
            @click="loadMore"
          >
            <Loader2 v-if="loadingMore" class="w-3.5 h-3.5 animate-spin" />
            <ChevronDown v-else class="w-3.5 h-3.5" />
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>
        </div>

        <!-- 空结果 -->
        <div
          v-else-if="searched && !loading && !errorCode"
          class="mt-8 text-center text-sm text-slate-400"
        >
          没有找到匹配的项目，换个描述试试？
        </div>

        <!-- 初始提示 -->
        <div v-else-if="!searched && !loading" class="mt-8 text-center text-xs text-slate-400">
          描述得越具体，越容易找到合适的项目，例如技术栈、用途、需要具备的功能。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  AlertCircle,
  ChevronDown,
  Compass,
  ExternalLink,
  GitFork,
  Loader2,
  RefreshCw,
  Search,
  Star,
  WifiOff,
} from 'lucide-vue-next'
import {
  searchLearning,
  type LearningErrorCode,
  type LearningParsed,
  type LearningRepo,
} from '~/utils/api'

const query = ref('')
const loading = ref(false)
const loadingMore = ref(false)
const searched = ref(false)
const items = ref<LearningRepo[]>([])
const parsed = ref<LearningParsed | null>(null)
const total = ref(0)
const errorCode = ref<LearningErrorCode | null>(null)
const errorMessage = ref('')
const page = ref(1)
const hasMore = ref(false)
const resolvedQuery = ref('')

const suggestions = [
  'Vue3 后台管理模板',
  'TypeScript 全栈项目',
  'Rust 入门练手',
  'AI Agent 框架',
  'Go 微服务脚手架',
]

const sortLabel = computed(() => {
  switch (parsed.value?.sort) {
    case 'stars':
      return '按 Star 排序'
    case 'updated':
      return '近期活跃（按 Star 排序）'
    default:
      return '按相关度排序'
  }
})

const formatCount = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)

const runSearch = async () => {
  const keyword = query.value.trim()
  if (!keyword || loading.value) return

  loading.value = true
  errorCode.value = null
  errorMessage.value = ''
  page.value = 1
  hasMore.value = false
  resolvedQuery.value = ''

  try {
    const result = await searchLearning(keyword, { limit: 20 })
    parsed.value = result.parsed ?? null

    if (!result.ok) {
      errorCode.value = result.code ?? 'GITHUB_ERROR'
      errorMessage.value = result.message ?? '未知错误'
      items.value = []
      total.value = 0
    } else {
      items.value = result.items ?? []
      total.value = result.total ?? 0
      page.value = result.page ?? 1
      hasMore.value = result.hasMore ?? false
      resolvedQuery.value = result.resolvedQuery ?? ''
    }
    searched.value = true
  } catch (err) {
    errorCode.value = 'GITHUB_ERROR'
    errorMessage.value = (err as Error).message
    items.value = []
    total.value = 0
    searched.value = true
  } finally {
    loading.value = false
  }
}

const loadMore = async () => {
  if (!hasMore.value || loadingMore.value || loading.value) return
  const keyword = query.value.trim()
  if (!keyword) return

  loadingMore.value = true
  try {
    const nextPage = page.value + 1
    const result = await searchLearning(keyword, {
      limit: 20,
      page: nextPage,
      resolvedQuery: resolvedQuery.value || undefined,
      sort: parsed.value?.sort,
    })

    if (!result.ok) {
      errorCode.value = result.code ?? 'GITHUB_ERROR'
      errorMessage.value = result.message ?? '未知错误'
      return
    }

    const existing = new Set(items.value.map((item) => item.id))
    const fresh = (result.items ?? []).filter((item) => !existing.has(item.id))
    items.value = [...items.value, ...fresh]
    page.value = nextPage
    hasMore.value = result.hasMore ?? false
    total.value = result.total ?? total.value
  } catch (err) {
    errorCode.value = 'GITHUB_ERROR'
    errorMessage.value = (err as Error).message
  } finally {
    loadingMore.value = false
  }
}

const useSuggestion = (suggestion: string) => {
  query.value = suggestion
  void runSearch()
}
</script>
