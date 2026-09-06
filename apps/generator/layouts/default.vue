<template>
  <div class="h-full flex bg-slate-100">
    <!-- 左侧边栏 -->
    <aside class="w-56 bg-sidebar-bg border-r border-sidebar-border flex flex-col flex-shrink-0">
      <!-- Logo + 标题 -->
      <div class="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-bold shadow-sm">
          G
        </div>
        <div class="min-w-0">
          <h1 class="text-sm font-semibold text-slate-800 truncate">AI Generator</h1>
          <p class="text-[10px] text-slate-400 truncate">组件 · Skill 生成器</p>
        </div>
      </div>

      <!-- 导航 -->
      <nav class="flex-1 py-2 overflow-y-auto light-scroll">
        <div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">生成</div>

        <button
          @click="$emit('navigate', 'component')"
          :class="[
            'nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            activeTab === 'component'
              ? 'active bg-sidebar-active text-sidebar-activeText font-medium'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
        >
          <span class="text-base">🧩</span>
          <span>组件生成</span>
        </button>

        <button
          @click="$emit('navigate', 'skill')"
          :class="[
            'nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            activeTab === 'skill'
              ? 'active bg-sidebar-active text-sidebar-activeText font-medium'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
        >
          <span class="text-base">🤖</span>
          <span>Skill 生成</span>
        </button>

        <!-- 分隔线 -->
        <div class="my-3 mx-3 h-px bg-slate-200"></div>

        <div class="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">即将推出</div>
        <button class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-400 cursor-not-allowed">
          <span class="text-base">📋</span>
          <span>历史记录</span>
          <span class="ml-auto text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">soon</span>
        </button>
        <button class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-400 cursor-not-allowed">
          <span class="text-base">⚙️</span>
          <span>设置</span>
        </button>
      </nav>

      <!-- 底部 -->
      <div class="border-t border-sidebar-border px-4 py-3 text-[11px] text-slate-400">
        <div>BFF: {{ useRuntimeConfig().public.bffUrl }}</div>
        <div class="mt-0.5">v0.1.0 · {{ useRuntimeConfig().public.appName }}</div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
defineProps<{ activeTab: 'component' | 'skill' }>()
defineEmits<{ navigate: [tab: 'component' | 'skill'] }>()
</script>
