import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://ai_study:123456@localhost:5432/ai_study_test'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    pool: 'forks',
    globalSetup: ['./tests/globalSetup.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.integration.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      // splitter.test.ts causes OOM on Windows tsx/esbuild transform
      // the splitterPure module itself is verified manually + by runtime usage
      'src/**/__tests__/splitter.test.ts',
    ],
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      ENABLE_GRAPH_SEARCH: '0',
      ENABLE_GRAPH_EXTRACT: '0',
      ENABLE_GRAPH_AGENT: '0',
    },
  },
  resolve: {
    alias: {
      '@ai-study/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
})
