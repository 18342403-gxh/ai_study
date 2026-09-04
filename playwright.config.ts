import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E 测试配置
 * 仅使用 Chromium（教学项目不需要多浏览器矩阵）
 *
 * 运行：
 *   npx playwright test              # 跑所有测试
 *   npx playwright test --headed     # 有头模式（看浏览器操作）
 *   npx playwright show-report       # 查看 HTML 报告
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3003',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: undefined, // 不自动启 server，由 Skill 脚本管理
})
