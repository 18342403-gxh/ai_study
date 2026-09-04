---
name: "e2e-verify"
description: "Playwright E2E verification for completed frontend features. Invoke when user says '验证一下', '测一下页面', 'E2E 测试', or explicitly asks to verify a finished feature in browser."
---

# E2E Verify — 前端功能端到端验证

使用 Playwright 对已完成的前端功能做端到端浏览器验证，生成可读的验证报告。

## When to Use

**CRITICAL: You MUST invoke this skill IMMEDIATELY as your FIRST action when:**
- 用户明确表示某个功能已完成，说"验证一下"、"测一下"、"跑一下 E2E"、"联调测试"
- 用户要求你在浏览器里验证某个页面/功能
- 一个功能模块开发全部完成后（如 Generator 双模式页面写完）

**DO NOT:**
- 不要在开发过程中（每次改一行代码）都触发验证
- 不要对后端 API 改动单独触发（除非涉及完整链路）
- 不要在用户说"继续开发"时触发

## 前置条件检查

执行前先确认：

1. **项目根目录有 `playwright.config.ts`** — 没有就跳过（这个 Skill 已创建该文件）
2. **目标服务能跑起来** — 需要知道被测试页面的 URL（如 `http://localhost:3003`）
3. **有可验证的功能点** — 不要跑空测试

## 执行步骤

### Step 1: 确认测试目标

向用户确认（或从上下文推断）：
- 要测试的页面 URL（如 `http://localhost:3003`）
- 要验证的核心功能点（如 "Generator 的 Skill 模式能生成 SKILL.md"）
- 功能名称（用于命名测试文件和报告）

### Step 2: 启动服务

确保被测试的前端和 BFF 都在运行：

```bash
# 如果还没启动，在后台启动
pnpm --filter @ai-study/server dev    # BFF :3001
pnpm --filter @ai-study/generator dev  # 前端 :3003
```

等服务启动完毕再继续。

### Step 3: 安装 Playwright（首次）

```bash
# 检查是否已安装
node -e "require('@playwright/test')" 2>/dev/null || echo "NEED_INSTALL"

# 如果输出 NEED_INSTALL，则执行：
pnpm add -D @playwright/test
npx playwright install chromium
```

### Step 4: 编写 E2E 测试用例

在项目根目录 `e2e/` 下创建测试文件，命名为 `<feature-name>.spec.ts`。

**测试用例模板：**

```typescript
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3003'

test.describe('功能名称', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
  })

  test('核心验证点 1', async ({ page }) => {
    // 操作步骤
    // 断言
    await expect(page.locator('text=预期文本')).toBeVisible()
  })

  test('核心验证点 2', async ({ page }) => {
    // ...
  })
})
```

**编写规则：**
- 每个 `test()` 只验证一件事
- 用 `data-testid` 属性定位元素（如果页面没有，优先用文本和 role）
- SSE 流式场景需要用 `await page.waitForTimeout(3000)` 等流式响应
- 生成按钮点击后等待进度节点出现再断言

### Step 5: 运行测试 + 生成报告

```bash
# 运行测试（有头模式能看到浏览器操作过程）
E2E_BASE_URL=http://localhost:3003 npx playwright test e2e/<feature-name>.spec.ts --headed

# 运行后生成 Markdown 验证报告
node .trae/skills/e2e-verify/scripts/generate-report.mjs --feature <feature-name>
```

### Step 6: 展示结果

执行完后必须：
1. 用 `npx playwright show-report` 打开 HTML 报告（或告诉用户路径）
2. 总结通过/失败数量
3. 失败的用例给出截图路径和错误描述
4. Markdown 报告保存在 `docs/e2e-reports/<feature-name>-<timestamp>.md`

## 报告格式

Markdown 验证报告结构：

```markdown
# E2E 验证报告：[功能名称]
- **时间**: YYYY-MM-DD HH:mm
- **目标 URL**: http://localhost:xxxx
- **Playwright**: 1.xx.x (chromium)

## 概览
| 指标 | 值 |
|------|-----|
| 总用例 | N |
| ✅ 通过 | N |
| ❌ 失败 | N |
| ⏭️ 跳过 | N |
| 通过率 | XX% |
| 耗时 | X.Xs |

## 用例详情
| # | 用例名 | 状态 | 耗时 | 截图 | 错误 |
|---|--------|------|------|------|------|
| 1 | xxx | ✅ | 1.2s | - | - |
| 2 | xxx | ❌ | 2.1s | [screenshot.png](../...) | Error: ... |

## 结论
- [ ] 所有核心功能通过，可以进入下一阶段
- [ ] 存在阻塞问题：xxx
- [ ] 非阻塞建议：xxx
```

## 注意事项

1. **不要破坏用户数据** — E2E 测试如果涉及数据库写入，用单独的测试库或测试账号
2. **Mock 外部 API** — 如果测试场景需要调用真实 LLM，考虑在 server 端加 mock 模式，避免消耗 API Key
3. **Windows 兼容性** — 这个 Skill 面向 Windows 环境，脚本用 `.mjs` 纯 Node.js，不要用 bash
4. **截图自动保留** — `playwright.config.ts` 已配置 `screenshot: 'only-on-failure'`，失败的用例自动有截图
