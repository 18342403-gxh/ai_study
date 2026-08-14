<script setup lang="ts">
const route = useRoute()

const tabs = [
  { label: '首页', icon: '🏠', to: '/' },
  { label: 'API', icon: '🔌', to: '/m1' },
  { label: '流式', icon: '⚡', to: '/m2' },
  { label: 'Chat', icon: '💬', to: '/m4' },
  { label: 'Agent', icon: '🤖', to: '/m7' },
]

const activeTab = computed(() => {
  if (route.path === '/') return '/'
  return tabs.find(t => t.to === route.path)?.to ?? ''
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header
      class="sticky top-0 z-50 bg-white hairline-bottom"
      :style="{ paddingTop: 'env(safe-area-inset-top)' }"
    >
      <div class="h-14 flex items-center justify-between px-4">
        <h1 class="text-lg font-semibold text-primary-600">AI 学习平台</h1>
        <span class="text-xs text-gray-400">Nuxt 3 SSR</span>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto">
      <slot />
    </main>

    <nav
      class="sticky bottom-0 z-50 bg-white hairline-bottom flex items-center justify-around"
      :style="{ paddingBottom: 'env(safe-area-inset-bottom)' }"
    >
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="flex flex-col items-center py-2 px-3 transition-colors"
        :class="activeTab === tab.to ? 'text-primary-600' : 'text-gray-400'"
      >
        <span class="text-xl">{{ tab.icon }}</span>
        <span class="text-xs mt-0.5">{{ tab.label }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>
