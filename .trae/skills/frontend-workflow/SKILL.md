---
name: "frontend-workflow"
description: "4-phase frontend module workflow: design → code → verify → teach. Invoke when user says '开始模块开发', '按工作流来', or wants to build a frontend feature with phase gates."
---

# Frontend Module Workflow — 前端模块开发工作流

一个**以模块为单位**的前端开发工作流，强制经过 4 个阶段，每个阶段完成后必须等待用户确认才能进入下一阶段。

## When to Use

**CRITICAL: You MUST invoke this skill IMMEDIATELY as your FIRST action when:**
- 用户说"开始模块开发"、"按工作流来"、"走一下流程"
- 用户明确要求按阶段推进开发
- 开发一个新的前端功能模块（不是修 bug）

**DO NOT:**
- 不要用于后端模块开发（后端工作流待后续定义）
- 不要用于简单的 bugfix 或小改动
- 不要在用户没说要用工作流时自行启动

## 核心约束（不可违反）

1. **以模块为单位** — 一个模块走完 4 阶段，才能开始下一个模块。禁止跨模块并行。
2. **阶段间必须 STOP** — 每个阶段完成后，输出交付物清单 + 等待用户确认。**禁止自行推进到下一阶段**。
3. **用户确认信号** — 以下回复视为"通过"：「继续」、「通过」、「ok」、「可以」、「approved」、「yes」、「下一步」、「没问题」。其他回复视为"未通过"。
4. **失败可回退** — 如果阶段未通过，修改后重新提交，不自动跳到下一个阶段。
5. **每个模块独立 commit** — 方案阶段可能不 commit（只有文档），代码/验证/讲解阶段各自独立 commit。

## 阶段总览

```
  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
  │ ① 方案  │ →  │ ② 代码  │ →  │ ③ 验证  │ →  │ ④ 讲解  │
  └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘
       │               │               │               │
    等待确认         等待确认         等待确认         等待确认
```

---

## Phase ① 方案（Design）

**目标**：把模糊需求转化为可执行的技术方案

**执行步骤**：
1. 向用户确认模块名称和需求（如果还没给清楚）
2. 理解现有代码：读相关文件、看现有 API、确认数据结构
3. 做技术选型（如果有多种选择）并向用户说明理由
4. 设计页面/组件结构、状态管理、API 契约
5. 写 `docs/<module>-design.md`

**设计文档模板**：
```markdown
# <模块名> 技术方案

## 1. 需求理解
- 用户故事 1
- 用户故事 2

## 2. 技术选型
| 选项 | 选择 | 理由 |
|------|------|------|

## 3. 架构设计
### 页面/组件结构
### 状态管理方案
### 数据流图

## 4. API 契约
| 端点 | 方法 | 请求体 | 响应 |
|------|------|--------|------|

## 5. 实现计划
- Task 1: xxx
- Task 2: xxx

## 6. 风险与约束
```

**阶段完成信号**：
```
✅ Phase ① 方案 完成

📄 交付物：
  - docs/<module>-design.md

请确认方案后说「继续」进入 Phase ② 代码阶段。
如果需要调整，请直接说。
```

---

## Phase ② 代码（Code）

**目标**：按方案实现前端代码，保证类型安全

**前置条件**：用户已确认方案阶段

**执行步骤**：
1. 读取并理解 Phase ① 产出的 design.md
2. 创建/修改代码文件，按方案实现
3. 运行 typecheck 确保零报错（除了已知的 web-vue 老问题）
4. 如果有 lint 配置，运行 lint 确保无 error
5. 提交代码：`git add -A && git commit -m "feat(<module>): <描述>"`
6. 更新 workflow state

**代码完成的最低标准**：
- 所有新增/修改文件通过 TypeScript typecheck
- 页面能编译通过（`nuxt build` 或 `vite build` 不报错）
- 没有硬编码 API Key 或 localhost 地址
- 没有 debug 用的 console.log 残留（warn 级别的可以留）

**阶段完成信号**：
```
✅ Phase ② 代码 完成

📄 交付物：
  - 新增/修改 N 个文件
  - Commit: abc123 - feat(<module>): <描述>
  - Typecheck: ✅ 通过

请确认代码后说「继续」进入 Phase ③ 验证阶段。
如果需要修改，请直接说。
```

---

## Phase ③ 验证（Verify）

**目标**：启动服务 + Playwright E2E 测试，生成验证报告

**前置条件**：用户已确认代码阶段

**执行步骤**：
1. 调用 `e2e-verify` Skill（不要自己实现验证逻辑）
2. 编写 E2E 测试用例 `e2e/<module>.spec.ts`
3. 启动前端 + BFF 服务
4. 运行 Playwright 测试：`npx playwright test e2e/<module>.spec.ts --headed`
5. 生成 Markdown 报告：`node .trae/skills/e2e-verify/scripts/generate-report.mjs --feature <module>`
6. 提交报告（docs/e2e-reports/ 目录）
7. 如果有失败用例，修复代码后重新跑，直到全部通过或用户决定接受现状

**阶段完成信号**：
```
✅ Phase ③ 验证 完成

📄 交付物：
  - e2e/<module>.spec.ts（测试用例）
  - docs/e2e-reports/<module>-<time>.md（验证报告）
  - 通过率: N/M (XX%)

请确认功能可用后说「继续」进入 Phase ④ 讲解阶段。
如果需要修复，请直接说。
```

---

## Phase ④ 讲解（Teach）

**目标**：把模块的技术要点、踩坑经验整理成教学文档

**前置条件**：用户已确认验证阶段

**执行步骤**：
1. 回顾整个模块的实现过程
2. 提炼 3-5 个核心技术点（如：这个组件的状态管理技巧、这个 API 的流式处理、这个坑是怎么踩的）
3. 写 `docs/<module>-guide.md`
4. 提交讲解文档

**讲解文档模板**：
```markdown
# <模块名> 技术拆解

## 核心技术点

### 1. <技术点标题>
**是什么**：<解释>
**为什么**：<选型理由>
**怎么做**：<关键代码片段 + 注释>
**替代方案**：<其他可选方案和 trade-off>

### 2. <技术点标题>
（同上结构）

## 踩坑记录
| 坑 | 现象 | 原因 | 解决 |
|----|------|------|------|

## 扩展阅读
- [参考 1](url)
- [参考 2](url)
```

**阶段完成信号**：
```
✅ Phase ④ 讲解 完成

📄 交付物：
  - docs/<module>-guide.md（技术拆解文档）

🎉 模块 <module> 开发完成！
可以开始下一个模块，或者让我总结一下。
```

---

## 状态追踪

用 `scripts/workflow-state.mjs` 管理当前进度：

```bash
# 查看当前状态
node .trae/skills/frontend-workflow/scripts/workflow-state.mjs current

# 初始化新模块
node .trae/skills/frontend-workflow/scripts/workflow-state.mjs init <module-name>

# 推进到下一阶段（在用户确认后调用）
node .trae/skills/frontend-workflow/scripts/workflow-state.mjs next
```

状态文件位置：`.trae/workflow-state.json`

---

## 异常处理

| 场景 | 处理方式 |
|------|---------|
| typecheck 不通过 | 列出错误，修复后重新提交。不跳过。 |
| Playwright 测试全部失败 | 检查服务是否启动、URL 是否正确。服务 OK 但测试不过 → 修复代码 → 重新跑 |
| 用户说"跳过这个阶段" | 询问确认，用户确认后跳过，在状态文件里记录 skipped |
| 用户说"回到方案阶段" | 重置状态，重新从 Phase ① 开始 |
| 上下文丢失（对话太长） | 读取 workflow-state.json 恢复进度，继续当前阶段 |

---

## 快速参考

当用户说「开始 Generator 历史记录模块开发」时：

```
1. init generator-history         → 状态重置
2. Phase ① 写 design.md           → 等待确认 ←
3. Phase ② 写代码 + commit        → 等待确认 ←
4. Phase ③ e2e-verify             → 等待确认 ←
5. Phase ④ 写 guide.md            → 完成
```
