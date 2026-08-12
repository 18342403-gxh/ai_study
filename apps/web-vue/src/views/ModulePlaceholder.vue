<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, RouterLink } from 'vue-router';

const route = useRoute();
const moduleId = computed(() => (route.meta?.moduleId as string) ?? 'm?');
const title = computed(() => (route.meta?.title as string) ?? '模块占位');
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white">
    <header class="px-6 pt-10 pb-6">
      <div class="mx-auto max-w-4xl">
        <RouterLink to="/" class="inline-flex items-center gap-2 text-sm text-indigo-300 hover:text-indigo-100 transition-colors mb-4">
          <span>←</span> 返回首页
        </RouterLink>
        <h1 class="text-2xl font-bold">{{ title }}</h1>
        <p class="mt-2 text-slate-400">
          模块 ID：<span class="font-mono text-indigo-300">{{ moduleId }}</span>
          &nbsp;·&nbsp; 该模块内容正在开发中，Vue3 端将与 React 端功能对齐。
        </p>
      </div>
    </header>

    <main class="px-6 pb-16">
      <div class="mx-auto max-w-4xl rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 text-3xl mb-4">
          🛠
        </div>
        <h2 class="text-xl font-semibold mb-2">模块占位页</h2>
        <p class="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
          该页面是 Vue3 端 <span class="text-indigo-300 font-medium">{{ moduleId }}</span> 模块的占位。
          在后续阶段，我们会把 React 端对应模块的核心逻辑迁移到 Vue3 Composition API。
        </p>
      </div>
    </main>
  </div>
</template>
