/**
 * 全局登录守卫：未登录跳转 /login；临时账号禁止进入超管页面。
 */

import { apiGet, type AuthMeResponse, type AuthUser } from '~/utils/api'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return

  const auth = useState<AuthUser | null>('authUser', () => null)

  if (!auth.value) {
    try {
      const me = await apiGet<AuthMeResponse>('/api/auth/me')
      auth.value = me.user
    } catch {
      return navigateTo('/login')
    }
  }

  if (to.path.startsWith('/admin') && auth.value.role !== 'admin') {
    return navigateTo('/chat')
  }
})
