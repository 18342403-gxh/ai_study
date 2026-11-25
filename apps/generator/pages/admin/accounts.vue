<template>
  <div class="h-full flex flex-col overflow-hidden">
    <header
      class="h-14 flex items-center justify-between px-6 border-b border-slate-100 flex-shrink-0"
    >
      <div>
        <h2 class="text-sm font-semibold text-slate-800">临时账号管理</h2>
        <p class="text-[11px] text-slate-400 mt-0.5">账号有效期 1 天，到期后知识库自动销毁</p>
      </div>
      <button
        class="h-9 px-4 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors"
        :disabled="creating"
        @click="create"
      >
        {{ creating ? '生成中…' : '生成临时账号' }}
      </button>
    </header>

    <div class="flex-1 overflow-y-auto light-scroll px-6 py-5">
      <!-- 新账号凭据（仅展示一次） -->
      <section
        v-if="created"
        class="mb-5 rounded-xl border border-primary-200 bg-primary-50/60 px-5 py-4"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="text-sm font-semibold text-primary-700">账号已生成</h3>
            <p class="text-[11px] text-primary-600/80 mt-0.5">
              密码只展示这一次，请立即复制并交给使用者
            </p>
          </div>
          <button class="text-xs text-primary-600 hover:text-primary-700" @click="created = null">
            关闭
          </button>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-2">
          <div
            class="flex items-center gap-2 rounded-lg bg-white border border-primary-100 px-3 py-2"
          >
            <span class="text-[11px] text-slate-400 w-10 flex-shrink-0">账号</span>
            <code class="flex-1 text-sm text-slate-700 truncate">{{ created.username }}</code>
            <button class="text-[11px] text-primary-600" @click="copy(created.username)">
              复制
            </button>
          </div>
          <div
            class="flex items-center gap-2 rounded-lg bg-white border border-primary-100 px-3 py-2"
          >
            <span class="text-[11px] text-slate-400 w-10 flex-shrink-0">密码</span>
            <code class="flex-1 text-sm text-slate-700 truncate">{{ created.password }}</code>
            <button class="text-[11px] text-primary-600" @click="copy(created.password)">
              复制
            </button>
          </div>
        </div>
        <p class="mt-2 text-[11px] text-primary-600/80">
          到期时间：{{ formatTime(created.expiresAt) }}
        </p>
      </section>

      <!-- 账号列表 -->
      <section class="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-[11px] text-slate-400 border-b border-slate-100">
              <th class="px-4 py-2.5 font-medium">账号</th>
              <th class="px-4 py-2.5 font-medium">创建时间</th>
              <th class="px-4 py-2.5 font-medium">到期时间</th>
              <th class="px-4 py-2.5 font-medium">剩余</th>
              <th class="px-4 py-2.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="px-4 py-10 text-center text-xs text-slate-400">加载中…</td>
            </tr>
            <tr v-else-if="accounts.length === 0">
              <td colspan="5" class="px-4 py-10 text-center text-xs text-slate-400">
                暂无临时账号，点击右上角生成
              </td>
            </tr>
            <tr
              v-for="account in accounts"
              v-else
              :key="account.id"
              class="border-b border-slate-50 last:border-0"
            >
              <td class="px-4 py-3">
                <code class="text-xs text-slate-700">{{ account.username }}</code>
              </td>
              <td class="px-4 py-3 text-xs text-slate-500">{{ formatTime(account.createdAt) }}</td>
              <td class="px-4 py-3 text-xs text-slate-500">{{ formatTime(account.expiresAt) }}</td>
              <td class="px-4 py-3 text-xs text-slate-500">
                {{ remainingText(account.expiresAt) }}
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  class="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
                  :disabled="deletingId === account.id"
                  @click="remove(account)"
                >
                  {{ deletingId === account.id ? '销毁中…' : '删除' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <p v-if="error" class="mt-4 text-xs text-red-500">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  apiDelete,
  apiGet,
  apiPost,
  type CreatedTempAccount,
  type TempAccountRow,
} from '~/utils/api'

useHead({ title: '临时账号 · 个人知识库' })

const accounts = ref<TempAccountRow[]>([])
const created = ref<CreatedTempAccount | null>(null)
const loading = ref(true)
const creating = ref(false)
const deletingId = ref<string | null>(null)
const error = ref('')

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await apiGet<{ users: TempAccountRow[] }>('/api/admin/users')
    accounts.value = res.users
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

const create = async () => {
  if (creating.value) return
  creating.value = true
  error.value = ''
  try {
    const res = await apiPost<CreatedTempAccount>('/api/admin/users', {})
    created.value = res
    await load()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    creating.value = false
  }
}

const remove = async (account: TempAccountRow) => {
  if (deletingId.value) return
  if (!window.confirm(`确定销毁临时账号 ${account.username}？其知识库会一并删除。`)) return
  deletingId.value = account.id
  error.value = ''
  try {
    await apiDelete(`/api/admin/users/${account.id}`)
    accounts.value = accounts.value.filter((item) => item.id !== account.id)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    deletingId.value = null
  }
}

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* 剪贴板不可用时忽略 */
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const formatTime = (ms: number | null): string => {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

const remainingText = (expiresAt: number | null): string => {
  if (!expiresAt) return '—'
  const diff = expiresAt - now.value
  if (diff <= 0) return '已过期'
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`
}

onMounted(async () => {
  timer = setInterval(() => (now.value = Date.now()), 30_000)
  await load()
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>
