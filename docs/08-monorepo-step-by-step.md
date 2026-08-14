# 08 · 从单体到 Monorepo：手把手改造教学（pnpm workspace）

> **前置条件**：你已经有一个 React + Vite + TypeScript 的前端单体项目（并含一个 Node BFF 子目录），希望引入 Vue3 端和公共包，统一用 **pnpm workspace** 管理。
> **最终产物**：`apps/`（多端应用）+ `packages/`（共享包）+ 根统一脚本 + 锁文件全复用。
> **本章知识点（12 个）**：workspace 协议、共享包 symlink、根脚本 filter、TS Project References vs paths、Vite alias 对齐、dual publish exports、TS 配置继承链、Node 内置模块 `node:` 前缀、`.d.ts` 声明文件、无类型包类型补全、fetch unknown 类型收窄、VSCode monorepo 工作区入口。

---

## 📋 改造总览（一步到位的路线图）

```
  BEFORE（单体）                    AFTER（Monorepo）
  ├─ package.json                  ├─ package.json            ← 根（scripts + workspace 管理）
  ├─ vite.config.ts                ├─ pnpm-workspace.yaml     ← workspaces 范围
  ├─ tsconfig.json                 ├─ tsconfig.json           ← IDE 工作区入口（references）
  ├─ index.html                    ├─ tsconfig.base.json      ← 公共 TS 配置（extends）
  ├─ src/*      (React)            ├─ apps/
  ├─ server/*   (Node)             │  ├─ web-react/           ← 原 React 项目整体迁入
  └─ ...                           │  ├─ web-vue/             ← 新增 Vue3 端
                                   │  └─ server/              ← 原 Node BFF 迁入
                                   └─ packages/
                                      └─ shared/              ← 新增公共类型/常量包
```

---

## Step 1. 为什么是 pnpm workspace（而不是 npm/yarn/turbo/nx）

| 方案 | workspace 内联包 | 幽灵依赖防护 | 安装速度 | 学习曲线 |
|---|---|---|---|---|
| **pnpm workspace** | ✅ 原生 `workspace:*` 协议，symlink 直连源码 | ✅ 严格（内容可寻址 store） | ⚡ | 低（1 个 yaml + `--filter`） |
| npm workspaces | ⚠️ 无协议，靠相对路径 + 手动 `npm link` | ❌ | 🐢 | 中 |
| yarn berry PnP | ✅ | ✅ | ⚡ | 高（编辑器兼容坑多） |
| Turborepo | 跑在 pnpm/npm 之上（任务编排，不是 workspace 替代品） | — | 🌪 | 中 |
| Nx | 同上，大而全（图缓存 + 生成器） | — | 🌪 | 高 |

**结论**：pnpm 是 monorepo 的「最小完备」方案 —— 本身就是 workspace 管理器 + 极快的依赖安装。Turborepo/Nx 都是「任务加速层」，等你有 5+ 个包、CI 构建慢的时候再加不迟。

---

## Step 2. 环境准备：Node 与 pnpm 版本对齐

⚠️ **常见踩坑**：`npx pnpm` 默认下载最新版，而最新 pnpm 11 要求 **Node ≥22.13**，如果你是 Node 16/18/20 会直接报错：
```
ERROR: This version of pnpm requires at least Node.js v22.13
```

### ✅ 正确做法（两种任选）

```bash
# 方案 A：全局装 pnpm 9（兼容 Node 18+）
npm install -g pnpm@9
pnpm --version   # 期望 9.x

# 方案 B：不全局装，每命令临时指定版本（本章全程用它）
npx pnpm@9 --version   # 期望 9.x
```

然后在**根 `package.json`** 里锁定 packageManager，让团队/CI 版本一致：
```json
{
  "name": "ai-study-monorepo",
  "private": true,
  "packageManager": "pnpm@9.15.9"
}
```
> `private: true` 是 monorepo 根的硬性要求，代表这个根包不发布到 npm，否则 pnpm 会警告。

---

## Step 3. 声明 workspace 范围：`pnpm-workspace.yaml`

在项目根创建这个文件（**文件名必须一字不差，pnpm 只认它**）：
```yaml
packages:
  - 'apps/*'        # 所有应用（前端、后端、桌面端…）
  - 'packages/*'    # 所有公共包（types、utils、ui-kit…）
```

### 🔑 知识点：什么会被算作「workspace 内的包」？
只要 `apps/*/package.json` 和 `packages/*/package.json` 存在，pnpm 就会把它们纳入 workspace。**子包之间相互引用时必须用同一个 scope 命名**，推荐 `@<项目名>/<包名>` 风格，一眼能看出内部依赖：

```
@ai-study/server        ← apps/server/package.json 里的 name
@ai-study/web-react     ← apps/web-react/package.json 里的 name
@ai-study/web-vue       ← apps/web-vue/package.json 里的 name
@ai-study/shared        ← packages/shared/package.json 里的 name
```

> 💡 命名规范：应用放 `apps/`（通常是可独立 build + run 的成品），共享库放 `packages/`（通常是被 apps `import` 的 library，不直接对外部署）。

验证 workspace 识别：
```bash
npx pnpm@9 m ls --depth -1
```
期望输出：
```
ai-study-monorepo@0.0.1 D:\project\ai_study (PRIVATE)
@ai-study/server@1.0.0 D:\project\ai_study\apps\server (PRIVATE)
@ai-study/web-react@0.0.1 D:\project\ai_study\apps\web-react (PRIVATE)
@ai-study/web-vue@0.0.1 D:\project\ai_study\apps\web-vue (PRIVATE)
@ai-study/shared@0.0.1 D:\project\ai_study\packages\shared
```
**看到 `(PRIVATE)` 或者不是 error，就说明 workspace 已经把所有包认出来了。**

---

## Step 4. 物理迁移：把单体代码搬到 apps/ 对应子目录

### 4.1 迁移 React 端 → `apps/web-react/`

```bash
# 命令行思路（Windows PowerShell 示例；也可以直接用 VSCode 资源管理器拖文件）
# 新建 apps/web-react
New-Item -ItemType Directory -Path apps/web-react -Force

# 把根目录的 React 相关文件整体迁入
Move-Item -Path src, index.html, vite.config.ts, tsconfig.json, postcss.config.js, tailwind.config.js, .env.example -Destination apps/web-react/
```

然后**修改迁入后的 `apps/web-react/package.json`**：

```diff
 {
-  "name": "ai-study",
+  "name": "@ai-study/web-react",
   "version": "0.0.1",
+  "private": true,
   "type": "module",
+  "description": "React 端 AI 学习应用（7 个模块完整实现）",
   "scripts": {
-    "dev": "vite",
+    "dev": "vite --port 5173 --host 127.0.0.1",
     "build": "tsc -b && vite build",
+    "preview": "vite preview --port 4173",
+    "typecheck": "tsc --noEmit -p tsconfig.json"
   },
   "dependencies": {
+    "@ai-study/shared": "workspace:*",
     "react": "^18.3.1",
     "...": "..."
   },
   "devDependencies": {
     "...": "..."
   }
 }
```

### 🔑 知识点：`workspace:*` 协议
```json
"@ai-study/shared": "workspace:*"
```
这是 pnpm workspace 的**灵魂语法**：
- pnpm 安装时，不会去 npm 拉 `@ai-study/shared`，而是在本地 workspace 里找同名包。
- 安装后，`apps/web-react/node_modules/@ai-study/shared` 是一个 **symlink（符号链接）**，直接指向 `packages/shared` 目录。
- ⚡ 这意味着：你改 `packages/shared/src/xxx.ts`，React / Vue / Server **不需要重新安装依赖**，热更新直接生效。
- `*` 代表「任意版本」，真正的版本取被引用包的 `package.json#version`；等发布 npm 时 pnpm 会自动把 `*` 换成真实版本号。

### 4.2 迁移 Node BFF → `apps/server/`

和 React 端一样，将原单体根的 `server/` 子目录直接改名为 `apps/server/`（如果原来 server 代码在根里，就整个搬到 `apps/server/`）。`apps/server/package.json` 的 `name` 改成 `@ai-study/server`，并同样加 `"@ai-study/shared": "workspace:*"`。

---

## Step 5. 新建公共包 `packages/shared/`

### 5.1 目录结构

```
packages/shared/
├── package.json          ← 库包配置（可发布）
├── tsconfig.json         ← extends 根 tsconfig.base.json
└── src/
    ├── index.ts          ← 统一入口（re-export）
    ├── types/
    │   ├── chat.ts
    │   ├── document.ts
    │   └── knowledge-base.ts
    └── constants/
        └── api.ts
```

### 5.2 `packages/shared/package.json`（可发布 library 模板）

```json
{
  "name": "@ai-study/shared",
  "version": "0.0.1",
  "private": false,
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "dev":   "tsup src/index.ts --format cjs,esm --dts --watch",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "tsup": "^8.1.0",
    "typescript": "^5.5.3"
  }
}
```

### 🔑 知识点：`exports` 字段 —— 现代 npm 包的「双入口 + 类型」
- `import`  → Node 14+ / Vite / Webpack 5 的 ESM 入口
- `require` → 老 Node 项目 / Jest 默认 / CJS 入口
- `types`   → TypeScript 类型查找入口（比 `@types/*` 更规范，类型跟随主包一起发布）

三者同时提供，叫 **dual publish**（ESM + CJS 双通道），保证你的共享包无论被哪类项目 import 都能跑。

### 5.3 类型与常量示例

**`types/chat.ts`**：
```ts
export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt?: number;
}
export interface SSEChunk { event?: string; data: string; }
```

**`constants/api.ts`**：
```ts
export const API_BASE_URL =
  (typeof window !== 'undefined' && window.location?.hostname)
    ? `http://${window.location.hostname}:3000`
    : 'http://127.0.0.1:3000';

export const API_ENDPOINTS = {
  CHAT: '/api/chat',
  CHAT_STREAM: '/api/chat/stream',
  DOCUMENTS: '/api/documents',
} as const;
```

**`index.ts` 统一 re-export**：
```ts
export * from './types/chat';
export * from './types/document';
export * from './types/knowledge-base';
export * from './constants/api';
```

---

## Step 6. 新建 Vue3 端 `apps/web-vue/` 骨架

### 6.1 `package.json`

```json
{
  "name": "@ai-study/web-vue",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174 --host 127.0.0.1",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview --port 4174",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@ai-study/shared": "workspace:*",
    "pinia": "^2.1.7",          // Vue3 官方状态管理（Vuex 替代）
    "vue": "^3.4.31",
    "vue-router": "^4.4.0"      // Vue Router v4
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.5",
    "tailwindcss": "3.4.10",
    "typescript": "^5.5.3",
    "vite": "^5.4.0",
    "vue-tsc": "^2.0.24"        // Vue 专用 TS 检查器（必须）
  }
}
```

### 6.2 目录 + 核心文件

```
apps/web-vue/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json / tsconfig.node.json
├── tailwind.config.js / postcss.config.js
└── src/
    ├── main.ts                ← 入口：app.use(pinia) + app.use(router)
    ├── App.vue                ← 根组件：<router-view />
    ├── style.css              ← @tailwind base/components/utilities
    ├── env.d.ts               ← declare module '*.vue'
    ├── router/index.ts        ← Vue Router v4（hash 模式 + / 首页 + /m1~/m7）
    ├── stores/counter.ts      ← Pinia Composition API 示例
    └── views/
        ├── Home.vue           ← 首页（7 模块卡片）
        └── ModulePlaceholder.vue  ← 模块占位页
```

### 6.3 Vue3 代码示例（和 React 对应）

**`main.ts` 入口**：
```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App)
app.use(createPinia())   // 对应 React 端的 <Provider store={store}>
app.use(router)          // 对应 React 端的 <BrowserRouter>
app.mount('#app')        // 对应 React 端的 createRoot().render()
```

**`router/index.ts`**：
```ts
import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/',  name: 'Home',            component: () => import('@/views/Home.vue') },
  { path: '/m1', name: 'Module1', meta: { title: '模块1' }, component: () => import('@/views/ModulePlaceholder.vue') },
  // ... m2~m7 同理
];

const router = createRouter({
  history: createWebHashHistory(),  // 对应 React Router 的 HashRouter（兼容性最好，不需要服务器重写）
  routes,
});

router.beforeEach((to, _from, next) => {
  if (to.meta?.title) document.title = to.meta.title as string;
  next();
});

export default router;
```

**`views/Home.vue`**（`<script setup lang="ts">` 是 Vue3 推荐的语法糖，写起来和 React FC 体感几乎一样）：
```vue
<script setup lang="ts">
import { RouterLink } from 'vue-router';

const modules = [
  { id: 'm1', title: '模块1 · AI API 基础', desc: '大模型 API 调用入门', tag: 'LLM API', path: '/m1' },
  // ...
];
</script>

<template>
  <main class="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white">
    <section class="mx-auto max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-4">
      <RouterLink
        v-for="m in modules" :key="m.id" :to="m.path"
        class="rounded-2xl border border-white/10 bg-white/5 p-5 hover:border-indigo-400/50 transition-all"
      >
        <h3 class="text-lg font-semibold mb-1.5">{{ m.title }}</h3>
        <p class="text-sm text-slate-400">{{ m.desc }}</p>
      </RouterLink>
    </section>
  </main>
</template>
```

> 🔑 心智模型：React `<a>` = Vue `<RouterLink>`；React `useState` = Vue `ref()`；React `useMemo` = Vue `computed()`；React `useEffect` = Vue `watch()` + `onMounted()`。后续逐模块对齐功能时，照着这个映射改即可。

---

## Step 7. 根 `package.json` —— 统一脚本 + 依赖治理

```json
{
  "name": "ai-study-monorepo",
  "private": true,
  "version": "0.0.1",
  "packageManager": "pnpm@9.15.9",
  "scripts": {
    "dev":         "pnpm --parallel --filter @ai-study/server --filter @ai-study/web-react dev",
    "dev:react":   "pnpm --filter @ai-study/web-react dev",
    "dev:vue":     "pnpm --filter @ai-study/web-vue dev",
    "dev:server":  "pnpm --filter @ai-study/server dev",
    "dev:all":     "pnpm --parallel --filter @ai-study/server --filter @ai-study/web-react --filter @ai-study/web-vue dev",
    "build":       "pnpm -r --filter @ai-study/shared --filter @ai-study/web-react --filter @ai-study/web-vue --filter @ai-study/server build",
    "build:vue":   "pnpm --filter @ai-study/web-vue build",
    "typecheck":   "pnpm -r typecheck",
    "lint":        "eslint \"{apps,packages}/**/*.{ts,tsx,vue}\"",
    "format":      "prettier --write \"{apps,packages}/**/*.{ts,tsx,vue,md,json}\""
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "prettier": "3.3.3",
    "typescript": "^5.5.3"
  }
}
```

### 🔑 知识点：3 个 pnpm 指令必须背熟

| 指令 | 作用 | 示例 |
|---|---|---|
| `--filter <包名>` | 只对指定包执行 | `pnpm --filter @ai-study/web-vue dev` → 只启动 Vue |
| `--parallel` | 多个包同时跑（dev 时使用，不会互相等） | `pnpm --parallel --filter A --filter B dev` |
| `-r / --recursive` | 对所有匹配的包依次跑（build/typecheck 常用，按依赖顺序） | `pnpm -r typecheck` → 每个子包跑 typecheck |

> 💡 端口提前规划好，避免 `dev:all` 冲突：React 5173 · Vue 5174 · Server 3001。这样三端可以同时跑在一台机器上。

---

## Step 8. TypeScript 配置 —— 三层继承链

```
tsconfig.base.json  （公共）
    ↑ extends
├─ packages/shared/tsconfig.json
├─ apps/web-react/tsconfig.json
├─ apps/web-vue/tsconfig.json
└─ apps/server/tsconfig.json
```

### 8.1 根 `tsconfig.base.json`（所有子项目 extends 它）

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@ai-study/shared":  ["packages/shared/src/index.ts"],
      "@ai-study/shared/*": ["packages/shared/src/*"]
    }
  }
}
```

### 8.2 子项目 `tsconfig.json`（以 web-react 为例）

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*":               ["src/*"],
      "@ai-study/shared":  ["../../packages/shared/src/index.ts"],
      "@ai-study/shared/*": ["../../packages/shared/src/*"]
    }
  },
  "include": ["src", "vite.config.ts", "tailwind.config.js", "postcss.config.js"]
}
```

### ⚠️ 两大常见踩坑 & 解决方案

#### ❌ 踩坑 A：TS Project References（`references` 字段）强制 build 顺序
很多教程会让你在子项目 tsconfig 写：
```json
"references": [{ "path": "../../packages/shared" }]
```
后果：**你必须先 `tsc -b packages/shared`（把公共包 build 成 `.d.ts` + `.tsbuildinfo`），否则子项目 `tsc --noEmit` 直接报 `TS6306 Referenced project must have setting "composite": true`。** 开发体验极差，改一行 shared 的 type 都要重新 build。

✅ **正确做法（小到中型 monorepo 推荐）**：**去掉 `references`，只用 `paths` 直连源码。**
```json
"paths": {
  "@ai-study/shared": ["../../packages/shared/src/index.ts"]
}
```
这样子项目的 tsc / vue-tsc 直接读共享包的 **`.ts 源码`**，shared 改完 typecheck 立刻生效，不用额外 build 步骤。

> 📌 什么时候真的需要 Project References？当你有 15+ 个包、TS 类型检查慢到几十秒时，用它可以做增量编译缓存。现在 4~5 个包完全没必要。

#### ❌ 踩坑 B：配置文件（vite.config.ts / tailwind.config.js）IDE 爆红
原因：`include` 默认只写了 `"src"`，配置文件没被 tsconfig 纳入，VSCode 打开 `vite.config.ts` 时 TS Server 找不到项目上下文 → 对 `node:path`、`defineConfig` 标红。

✅ 修复：把它们也加入 include：
```json
"include": ["src", "vite.config.ts", "tailwind.config.js", "postcss.config.js"]
```

### 8.3 ⭐ 根再补一个 tsconfig.json：VSCode 工作区入口
```json
{
  "files": [],
  "references": [
    { "path": "./packages/shared" },
    { "path": "./apps/web-react" },
    { "path": "./apps/web-vue" },
    { "path": "./apps/web-vue/tsconfig.node.json" },
    { "path": "./apps/server" }
  ]
}
```
**🔑 知识点**：VSCode 的 TypeScript Server 在打开整个仓库时，会找**顶层的 tsconfig.json**。如果根目录没有（我们在单体→monorepo 迁移时把旧单体的 tsconfig 删掉了），VSCode 就会对不在任何子项目 include 范围内的文件报各种「假红」。

这个 `"files": []` 表示它本身不编译任何文件，只做一个「调度器」角色，通过 `references` 告诉 TS Server「整个工作区由这些子项目组成」。保存后重启 TS Server（Ctrl+Shift+P → Restart TS Server），全项目假红会大面积消失。

---

## Step 9. Vite `resolve.alias` 必须与 tsconfig `paths` 对齐

**只配 tsconfig paths 是不够的** —— tsc 和 IDE 认别名，但 **Vite 打包时根本不读 tsconfig.json**，所以两边必须各写一份，路径保持一致：

### React 端 vite.config.ts：
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'   // 🔑 知识点：Node 16+ 推荐加 'node:' 前缀区分内置模块

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@':              path.resolve(__dirname, './src'),
      '@ai-study/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
})
```

### Vue 端 vite.config.ts 同理：
```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@':              path.resolve(__dirname, './src'),
      '@ai-study/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
})
```

> 🔑 为什么要写 `node:path` 而不是 `path`？Node 文档明确推荐 `node:` 前缀，好处是一眼能看出这是 Node 内置模块，避免和你自己写的 `./utils/path.ts` 这种同名文件冲突。TS 会通过 `@types/node` 正确识别，不用担心。

---

## Step 10. 安装依赖（根目录一次性装完）

```bash
cd d:\project\ai_study
npx pnpm@9 install
```

这一步会：
1. 分析 5 个 `package.json`（root + 4 子包），把依赖放到**同一个内容可寻址 store**；
2. 生成一个**根级锁文件** `pnpm-lock.yaml`（只有一个！这是 monorepo 的关键特性 —— 所有包版本一致性天然保证，不会出现各 app 各有一个 `package-lock.json` 互相打架）；
3. 对内部依赖 `@ai-study/shared`，创建 symlink 指向 `packages/shared`；
4. 对 better-sqlite3 / esbuild 等「原生二进制依赖」，自动根据当前平台（win32-x64 / darwin-arm64 等）下载正确的 prebuilt 二进制。

### ⚠️ Windows 常见报错 & 处理
```
TRAE Sandbox Error: hit restricted Not allow operate files: C:\Users\WIndows\AppData\Local\pnpm-cache
```
这是沙箱/企业代理工具对缓存目录写权限限制，**不影响 pnpm install 结果**（你会看到上面已经打印 `Done in 17.3s using pnpm v9.15.9`）。真实项目正常本机开发不会有这个问题。

---

## Step 11. 迁移后的常见 TS 错误修复（3 个高频）

### 🐛 错误 1：`TS7016 Could not find a declaration file for module 'pdf-parse'`
原因：有些老 npm 包（比如 `pdf-parse`）是纯 JS，既不在包里带 `.d.ts`，也没有 `@types/pdf-parse` 可用。

✅ 修复：为它写一个「项目内声明文件」—— `apps/server/src/types/declarations.d.ts`：
```ts
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer | ArrayBuffer, options?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}
```
> 💡 小技巧：`.d.ts` 文件名随意，放在 server 的 tsconfig `include` 路径里就能自动被加载。里面 `declare module 'xxx'` 就是告诉 TS「这个模块长这样，别报错了」。

### 🐛 错误 2：`TS18046 'data' is of type 'unknown'`
原因：Node 严格模式下 `await fetch().json()` 的返回类型是 `unknown`（TS 不知道服务端会回什么），直接 `.data[0].embedding` 会被拦住。

✅ 修复：显式做类型断言（type narrowing），别写 `as any`，把结构告诉 TS：
```ts
const data = (await response.json()) as {
  data: Array<{ embedding: number[] }>;
};
return data.data[0].embedding;
```

### 🐛 错误 3：`node:path` / `__dirname` 在 ESM 里的替换
Server 端 tsconfig 如果用 `"module": "NodeNext"`（ESM），`__dirname` 这个 CommonJS 变量会报未定义。

✅ 修复：用标准 ESM 方式拿到当前目录：
```ts
import { fileURLToPath } from 'url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 然后就能继续 path.join(__dirname, '../../uploads') 了
```

---

## Step 12. 清理单体根目录遗留文件 + 最终验证

### 12.1 删除「已迁入 apps/」的根目录冗余文件
迁移完成后，根目录应该**不再保留**下列文件（它们的新版本都在 `apps/web-react/` 或 `apps/server/` 里了）：
```
src/                       → 已在 apps/web-react/src
server/                    → 已在 apps/server
index.html                 → 已在 apps/web-react/index.html
vite.config.ts             → 已在 apps/web-react/vite.config.ts
tsconfig.json(单体版)      → 替换为新的 workspace 版本（Step 8.3）
postcss.config.js          → 已在 apps/web-react/ + apps/web-vue/
tailwind.config.js         → 同上
package-lock.json          → pnpm 用 pnpm-lock.yaml
.env.example               → 各 app 子目录自己有
```

### 12.2 最终验证 Checklist（通关才算改造完）

```bash
# ① workspace 包识别
npx pnpm@9 m ls --depth -1
# 期望：列出 root + 4 子包，没有 warning

# ② 类型检查（逐个包或根 -r）
npx pnpm@9 typecheck
# 期望：4 个子包全部 exit 0

# ③ Server 启动
npx pnpm@9 dev:server    # 期望：打印 Server running on http://localhost:3001

# ④ React 启动
npx pnpm@9 dev:react     # 期望：VITE v5.x ready → http://127.0.0.1:5173/ (或 5174)

# ⑤ Vue 启动
npx pnpm@9 dev:vue       # 期望：VITE v5.x ready → http://127.0.0.1:5174/

# ⑥ 浏览器打开，控制台 0 error（只有 React DevTools info 提示正常）
#    首页应显示 7 个模块卡片 + TabBar
```

全部通过后，用下面的命令整理 commit message（示例，可直接用）：
```
feat: 改造为 pnpm monorepo，新增 Node BFF、Vue3 端和 shared 公共包

- workspace: 新增 pnpm-workspace.yaml + 根脚本（--filter/--parallel/-r）
- apps/web-react:  原单体 React 项目迁移 + 接入 @ai-study/shared + 端口 5173
- apps/server:     原 Node Express BFF 迁移 + pdf-parse 声明文件 + fetch 类型修复
- apps/web-vue:    新增 Vue3 + Vite + Pinia + Vue Router 骨架（端口 5174）
- packages/shared: 新增公共类型包 chat/document/knowledge-base + API 常量
- tsconfig: 三层继承链（base + workspace 入口），paths 直连 shared 源码替代 references
- cleanup: 删除根 src/server/index.html 等已迁移冗余文件，统一 pnpm-lock.yaml
- verify: 4 子包 typecheck 通过，Server:3001 / React Vite:5174 启动正常
```

---

## 🎓 12 个知识点速查表（章节索引）

| # | 知识点 | 在哪一步 |
|---|---|---|
| 1 | **pnpm workspace 协议** vs npm/yarn/turbo/nx 选型 | Step 1 |
| 2 | **`workspace:*`** 内部依赖 symlink 机制 & `packageManager` 版本锁 | Step 2 + Step 4 |
| 3 | `pnpm-workspace.yaml` 范围 & 包命名规范 `@scope/name` | Step 3 |
| 4 | **根脚本三剑客**：`--filter` / `--parallel` / `-r` 用法 | Step 7 |
| 5 | **TS Project References vs paths 直连源码** —— 小中型项目推荐后者 | Step 8.2 |
| 6 | **tsconfig 三层继承链**（base → 子项目） + VSCode 工作区入口 tsconfig | Step 8.1/8.3 |
| 7 | **Vite `resolve.alias` 与 tsconfig `paths` 必须双侧对齐**（单侧只让 IDE 不红，打包会炸）| Step 9 |
| 8 | `exports` 字段 **dual publish**（ESM + CJS + 类型三入口）+ tsup 构建 | Step 5.2 |
| 9 | `node:` 前缀 & ESM 下 `__dirname` 替换为 `fileURLToPath(import.meta.url)` | Step 9 + Step 11 |
| 10 | `.d.ts` 声明文件修复无类型老包 `declare module 'xxx' { }` | Step 11.1 |
| 11 | `fetch().json()` 返回 `unknown` → 显式类型断言（避免 `as any`） | Step 11.2 |
| 12 | 根 `pnpm-lock.yaml` 统一锁文件 & workspace 验证 Checklist | Step 10 + Step 12 |

---

## 🗺 后续可以做的进阶（不在本章范围）

1. **引入 Turborepo**：`pnpm add -wD turbo`，`turbo run build typecheck` 利用任务图缓存，多包 build 时间从分钟压到秒级。
2. **引入 Changesets**：`@changesets/cli` —— 管理多包版本号 + 自动生成 Changelog + 一键发 npm。
3. **`packages/ui`**：再拆一个 UI 组件包（Button/Input/ChatBubble…），让 React 和 Vue 端各实现一份，但统一使用 shared 里的 Props 类型约束。
4. **Dockerfile 分层**：利用 pnpm 的 `--filter` + `--prod` 打最小镜像，只把 server 需要的依赖装进去。

—— 祝改造顺利！Monorepo 一旦搭好，后续新增一个 app/package 只是「复制模板 + 改 name」的 3 分钟事情。
