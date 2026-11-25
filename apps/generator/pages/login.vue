<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-100 px-4">
    <div class="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-7">
      <div class="flex flex-col items-center text-center mb-6">
        <img :src="techCatLogo" alt="个人知识库" class="h-16 w-auto" />
        <h1 class="mt-3 text-lg font-semibold text-slate-800">个人知识库</h1>
        <p class="mt-1 text-xs text-slate-400">登录后使用属于你的知识库</p>
      </div>

      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1.5" for="username">账号</label>
          <input
            id="username"
            v-model.trim="username"
            type="text"
            autocomplete="username"
            placeholder="请输入账号"
            class="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm text-slate-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1.5" for="password">密码</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            class="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm text-slate-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          />
        </div>

        <p v-if="error" class="text-xs text-red-500">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading || !username || !password"
          class="w-full h-10 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {{ loading ? '登录中…' : '登录' }}
        </button>
      </form>

      <!-- 临时账号申请入口 -->
      <div class="mt-5 border-t border-slate-100 pt-5">
        <p class="text-center text-xs text-slate-500 mb-3">还没有账号？</p>
        <button
          type="button"
          :disabled="applying"
          class="w-full h-10 rounded-lg border border-dashed border-primary-300 bg-primary-50/50 text-primary-600 text-sm font-medium hover:bg-primary-50 transition-colors disabled:opacity-50"
          @click="applyTemp"
        >
          {{ applying ? '生成中…' : '一键申请临时账号（1 天有效）' }}
        </button>

        <div v-if="applied" class="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 p-3">
          <p class="text-[11px] text-emerald-700 font-medium mb-2">账号已生成，请立即复制</p>
          <div class="space-y-2">
            <div class="flex items-center gap-2 text-xs text-slate-600">
              <span class="w-12 text-slate-400">账号</span>
              <code class="flex-1 font-mono">{{ applied.username }}</code>
              <button
                class="text-emerald-600 hover:text-emerald-700"
                @click="copy(applied.username)"
              >
                复制
              </button>
            </div>
            <div class="flex items-center gap-2 text-xs text-slate-600">
              <span class="w-12 text-slate-400">密码</span>
              <code class="flex-1 font-mono">{{ applied.password }}</code>
              <button
                class="text-emerald-600 hover:text-emerald-700"
                @click="copy(applied.password)"
              >
                复制
              </button>
            </div>
          </div>
          <button
            class="mt-3 w-full h-8 rounded-md bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600"
            @click="useAppliedLogin"
          >
            使用新账号登录
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import techCatLogo from '@brand/tech_cat.png'
import { apiPost, type AuthMeResponse, type AuthUser, type CreatedTempAccount } from '~/utils/api'

definePageMeta({ layout: false })
useHead({ title: '登录 · 个人知识库' })

const username = ref('')
const password = ref('')
const loading = ref(false)
const applying = ref(false)
const applied = ref<CreatedTempAccount | null>(null)
const error = ref('')
const auth = useState<AuthUser | null>('authUser', () => null)

const submit = async () => {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await apiPost<AuthMeResponse>('/api/auth/login', {
      username: username.value,
      password: password.value,
    })
    auth.value = res.user
    await navigateTo('/chat')
  } catch (err) {
    error.value = (err as Error).message || '登录失败'
  } finally {
    loading.value = false
  }
}

const applyTemp = async () => {
  if (applying.value) return
  applying.value = true
  error.value = ''
  try {
    const res = await apiPost<CreatedTempAccount>('/api/auth/apply-temp', {})
    applied.value = res
  } catch (err) {
    error.value = (err as Error).message || '申请失败'
  } finally {
    applying.value = false
  }
}

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* 忽略 */
  }
}

const useAppliedLogin = async () => {
  if (!applied.value) return
  username.value = applied.value.username
  password.value = applied.value.password
  applied.value = null
}
</script>
