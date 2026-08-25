<script setup lang="ts">
import SideNav from '~/components/SideNav.vue'
</script>

<template>
  <div class="h-screen flex bg-slate-50">
    <SideNav />
    <main class="flex-1 flex flex-col overflow-hidden">
      <slot />
    </main>
  </div>
</template>
