import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  ssr: true,

  modules: [
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
  ],

  runtimeConfig: {
    bffUrl: process.env.BFF_URL || 'http://localhost:3001',
    public: {
      appName: 'AI 学习平台',
    },
  },

  alias: {
    '@ai-study/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
  },

  vite: {
    optimizeDeps: {
      include: ['@ai-study/shared'],
    },
  },

  app: {
    head: {
      title: 'AI 学习平台 — Vue3 SSR',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'AI + C 端双侧重学习平台 — Nuxt 3 SSR' },
      ],
    },
  },

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: '~/tailwind.config.ts',
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },
})
