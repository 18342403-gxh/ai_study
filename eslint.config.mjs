import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'
import localRules from './eslint-rules/index.cjs'

const rulesPlugin = { rules: localRules.rules }

// Nuxt 3 自动导入的 composables（全局可用）
const NUXT_GLOBALS = [
  'useRuntimeConfig', 'useState', 'useFetch', 'useAsyncData', 'useLazyFetch',
  'useLazyAsyncData', 'useError', 'clearError', 'navigateTo', 'abortNavigation',
  'addRouteMiddleware', 'defineNuxtRouteMiddleware', 'useRoute', 'useRouter',
  'useHead', 'useSeoMeta', 'useServerSeoMeta', 'definePageMeta', 'onBeforeRouteLeave',
  'onBeforeRouteUpdate', 'useCookie', 'useRequestHeaders', 'useRequestEvent',
  'setResponseStatus', 'setPageTransition', 'setLayoutTransition', 'useHydration',
  'callWithNuxt', 'tryUseNuxtApp', 'useNuxtApp', '$fetch',
]

// Vue 3 auto-import（Nuxt 和 Vite Vue 都自动导入）
// 项目自定义 Nuxt composables（auto-import）
const PROJECT_COMPOSABLES = ['useChat', 'useAgent', 'useRag']

const VUE_GLOBALS = [
  'ref', 'reactive', 'computed', 'watch', 'watchEffect', 'nextTick', 'onMounted',
  'onUnmounted', 'onBeforeMount', 'onBeforeUnmount', 'onUpdated', 'onBeforeUpdate',
  'onErrorCaptured', 'onActivated', 'onDeactivated', 'onServerPrefetch',
  'provide', 'inject', 'toRef', 'toRefs', 'toRaw', 'markRaw', 'isRef', 'isReactive',
  'isProxy', 'isRaw', 'defineComponent', 'defineAsyncComponent', 'defineEmits',
  'defineProps', 'defineExpose', 'defineSlots', 'withDefaults', 'shallowRef',
  'shallowReactive', 'triggerRef', 'customRef', 'effectScope', 'getCurrentScope',
  'onScopeDispose', 'h', 'cloneVNode', 'mergeProps', 'resolveComponent', 'resolveDirective',
  'withDirectives', 'openBlock', 'createBlock', 'block', 'useSlots', 'useAttrs',
]

const BROWSER_GLOBALS = [
  'fetch', 'Blob', 'File', 'DragEvent', 'URL', 'URLSearchParams', 'document', 'window', 'navigator',
  'confirm', 'alert', 'console', 'HTMLElement', 'HTMLDivElement', 'HTMLInputElement',
  'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement',
  'TextDecoder', 'TextEncoder', 'FormData', 'Headers', 'Request', 'Response',
  'localStorage', 'sessionStorage', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'AbortController', 'AbortSignal', 'Event', 'CustomEvent',
  'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'InputEvent', 'ChangeEvent',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'BigInt',
  'Intl', 'crypto', 'performance', 'structuredClone', 'RegExp',
]

const makeGlobalObj = (names) => Object.fromEntries(names.map(n => [n, 'readonly']))

export default tseslint.config(
  // ============ 全局忽略 ============
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      '**/*.config.*',
      'scripts/**',
      'eslint-rules/**',
      '.trae/**',
      'apps/server/scripts/**',
      'apps/server/drizzle/**',
      'apps/generator/nuxt.config.ts',
    ],
  },

  // ============ JS/TS 基础 ============
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // ============ Vue ============
  ...pluginVue.configs['flat/recommended'],

  // ============ Prettier 关闭冲突规则 ============
  prettier,

  // ============ 通用规则 + globals ============
  {
    plugins: { 'local-rules': rulesPlugin },
    languageOptions: {
      globals: {
        ...makeGlobalObj(NUXT_GLOBALS),
        ...makeGlobalObj(PROJECT_COMPOSABLES),
        ...makeGlobalObj(VUE_GLOBALS),
        ...makeGlobalObj(BROWSER_GLOBALS),
      },
    },
    rules: {
      // 🚫 禁止 emoji 当 UI 图标 — 项目红线
      'local-rules/no-emoji': 'error',

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-empty': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',
      'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 4],
      // 暂时降为 warn，后续逐步消除 any
      // any 在 JSON.parse、SSE event、动态表单等场景下难以避免，降为 off
      // 新项目可以先开 warn，逐步收紧到 error
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },

  // ============ React Hooks — 只对 React/TSX 生效 ============
  {
    files: ['**/*.{tsx,jsx}', 'apps/web-react/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ============ Vue 文件 ============
  {
    files: ['**/*.vue'],
    plugins: { 'local-rules': rulesPlugin },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',
      'vue/html-self-closing': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/attributes-order': 'off',
      // Vue 里没有 React Hooks
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      // Vue template 里的 emoji 也禁止
      'local-rules/no-emoji': 'error',
    },
  },

  // ============ Electron 主进程 — 允许 console ============
  {
    files: ['apps/desktop/src/main/**/*.{ts,js}'],
    rules: {
      'no-console': 'off',
      'max-depth': 'off',
    },
  },

  // ============ Server 端 — 放宽部分规则 ============
  {
    files: ['apps/server/**/*.{ts,js}'],
    rules: {
      '@typescript-eslint/no-namespace': 'off',
      'no-irregular-whitespace': 'off',
    },
  },

  // ============ 所有文件 — 禁用实验性/过于严格的规则 ============
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/purity': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
)
