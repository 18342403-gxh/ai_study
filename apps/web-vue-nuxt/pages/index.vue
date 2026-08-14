<script setup lang="ts">
const counter = ref(0)
</script>

<template>
  <div>
    <h1>Hello from Nuxt SSR</h1>
    <p>Counter: {{ counter }}</p>
    <button @click="counter++">+1</button>
  </div>
</template>
