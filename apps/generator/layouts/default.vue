<template>
  <div class="min-h-screen flex flex-col">
    <!-- 顶栏 -->
    <header class="h-14 border-b bg-white flex items-center px-6 flex-shrink-0">
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-bold">
          G
        </div>
        <h1 class="text-base font-semibold text-slate-800">{{ useRuntimeConfig().public.appName }}</h1>
      </div>
      <div class="ml-auto flex items-center gap-3 text-xs text-slate-500">
        <span>BFF: {{ useRuntimeConfig().public.bffUrl }}</span>
      </div>
    </header>

    <!-- 主区域 -->
    <main class="flex-1 overflow-hidden">
      <slot />
    </main>
  </div>
</template>
