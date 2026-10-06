import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    pool: 'forks',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.integration.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      // splitter.test.ts causes OOM on Windows tsx/esbuild transform
      // the splitterPure module itself is verified manually + by runtime usage
      'src/**/__tests__/splitter.test.ts',
    ],
    testTimeout: 10000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: {
      '@ai-study/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
})
