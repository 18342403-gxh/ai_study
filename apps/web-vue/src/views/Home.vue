<script setup lang="ts">
import { RouterLink } from 'vue-router';

interface ModuleItem {
  id: string;
  title: string;
  desc: string;
  path: string;
  tag: string;
}

const modules: ModuleItem[] = [
  { id: 'm1', title: '模块 1 · AI API 基础', desc: 'OpenAI / 国产大模型 API 调用入门', path: '/m1', tag: 'LLM API' },
  { id: 'm2', title: '模块 2 · 流式响应', desc: 'SSE + Vite 流式渲染，打字机效果', path: '/m2', tag: 'SSE · Stream' },
  { id: 'm3', title: '模块 3 · Prompt 实验室', desc: 'Prompt 模板、变量注入、Token 计数', path: '/m3', tag: 'Prompt Eng.' },
  { id: 'm4', title: '模块 4 · Chat UI', desc: '多会话、消息列表、Markdown 渲染', path: '/m4', tag: 'UI / UX' },
  { id: 'm5', title: '模块 5 · Function Calling', desc: '工具调用定义、执行器、天气示例', path: '/m5', tag: 'Tools' },
  { id: 'm6', title: '模块 6 · RAG 检索增强', desc: '文档上传、切分、向量检索', path: '/m6', tag: 'RAG' },
  { id: 'm7', title: '模块 7 · AI Agent', desc: 'ReAct 推理循环、任务规划、Timeline', path: '/m7', tag: 'Agent' },
];
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white">
    <header class="px-6 pt-12 pb-8">
      <div class="mx-auto max-w-5xl">
        <div class="inline-flex items-center gap-2 rounded-full bg-indigo-500/10 border border-indigo-400/30 px-3 py-1 text-xs text-indigo-200 mb-4">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          Vue3 · Vite · Pinia · Tailwind v3
        </div>
        <h1 class="text-4xl font-bold tracking-tight">
          <span class="bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300 bg-clip-text text-transparent">
            AI Frontend Lab
          </span>
        </h1>
        <p class="mt-3 text-lg text-slate-300 max-w-2xl">
          Vue3 版本的 AI 前端应用学习项目。这里包含 7 个模块，从基础的 API 调用到 RAG + Agent 的完整链路。
        </p>
        <p class="mt-2 text-sm text-slate-400">
          提示：本页面为 Vue3 端骨架，具体模块功能会在后续阶段逐步实现。
        </p>
      </div>
    </header>

    <main class="px-6 pb-16">
      <div class="mx-auto max-w-5xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <RouterLink
          v-for="m in modules"
          :key="m.id"
          :to="m.path"
          class="group rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-5 hover:border-indigo-400/50 hover:bg-indigo-500/10 transition-all"
        >
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-medium px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-200 border border-indigo-400/20">
              {{ m.tag }}
            </span>
            <span class="text-slate-500 group-hover:text-indigo-300 transition-colors text-xl">→</span>
          </div>
          <h3 class="text-lg font-semibold mb-1.5 group-hover:text-indigo-200 transition-colors">
            {{ m.title }}
          </h3>
          <p class="text-sm text-slate-400 leading-relaxed">{{ m.desc }}</p>
        </RouterLink>
      </div>
    </main>

    <footer class="px-6 pb-8 text-center text-xs text-slate-500">
      Monorepo · @ai-study/web-vue · workspace:@ai-study/shared
    </footer>
  </div>
</template>
