import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Pinia Store 示例 - 作为状态管理骨架占位
 * 后续会替换为 chat / session / knowledge 等业务 store
 */
export const useCounterStore = defineStore('counter', () => {
  const count = ref(0);

  function increment() {
    count.value++;
  }

  function decrement() {
    count.value--;
  }

  function reset() {
    count.value = 0;
  }

  return { count, increment, decrement, reset };
});
