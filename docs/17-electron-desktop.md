# Phase 11：Electron 桌面端 — 架构设计

> 📌 本文档为 Electron 桌面端的**架构设计阶段输出**，仅定义方案，**不创建任何实际代码**。
> 实际开发需等待 Nuxt 3 SSR 主线 + Generator 前端完成后再启动。

---

## 1. 定位与目标

Electron 桌面端是整个项目的**产品化终态**——把"浏览器里的 AI 组件生成器"变成"用户电脑上的独立应用"。

| 维度 | 目标 |
|------|------|
| **产品定位** | AI 组件生成器的桌面分发形态，离线可用（除 AI 调用需联网） |
| **教学定位** | 展示"同一个前后端项目，如何从 Web 形态变成桌面形态" |
| **复用率** | 前端（generator）100% 复用 · 后端（BFF）100% 复用 · 仅壳层和 preload 新写 |

### 与其他子项目的关系

```
┌──────────────────────────────────────────────────────────┐
│                    apps/                                 │
│                                                          │
│  server/  ──  Express + LangChain + SQLite/PG            │
│  (BFF)         100% 被桌面端复用（内嵌启动）               │
│                                                          │
│  generator/ ── Nuxt 3 SSR                                │
│  (前端)        100% 被桌面端复用（内嵌浏览器加载）          │
│                                                          │
│  desktop/ ── Electron 壳                                 │
│  (本项目)      只写主进程 + preload + 原生能力桥接         │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 三种架构方案对比

### 方案 A：内嵌 BFF + 内嵌前端（推荐 ✅）

```
┌───────────────────────────────────────────────────────────┐
│  Electron 主进程                                           │
│  ├── fork() apps/server → 绑定随机 localhost 端口         │
│  ├── fork() apps/generator → 绑定随机 localhost 端口      │
│  ├── 创建 BrowserWindow → loadURL(generator localhost)    │
│  └── 注册 IPC handlers（preload → main）                   │
├───────────────────────────────────────────────────────────┤
│  Electron 预加载脚本 (preload.js)                          │
│  └── contextBridge.exposeInMainWorld('desktop', {         │
│        chooseDirectory, saveFile, openExternal,            │
│        getAppVersion, getPlatform                          │
│      })                                                    │
├───────────────────────────────────────────────────────────┤
│  渲染进程（复用 generator 前端）                             │
│  ├── 通过 HTTP localhost 调用 BFF API（和 Web 端完全一样）   │
│  └── 通过 window.desktop 调用桌面特有能力                   │
└───────────────────────────────────────────────────────────┘
```

| 维度 | 评估 |
|------|------|
| 复用率 | ⭐⭐⭐⭐⭐ 前后端 100% 复用 |
| 独立性 | ⭐⭐⭐⭐⭐ 完全自包含，不依赖外部服务 |
| 复杂度 | ⭐⭐⭐ 需要处理进程间通信和生命周期 |
| 教学价值 | ⭐⭐⭐⭐⭐ 展示 Electron 如何包裹已有项目 |
| 打包体积 | ⭐⭐ 较大（Electron runtime ~100MB + Node 依赖） |

### 方案 B：薄壳模式（BFF 独立运行）

```
┌─────────────────────────────────────┐
│  Electron 主进程                      │
│  └── loadURL('http://localhost:3003')│
├─────────────────────────────────────┤
│  外部独立运行                         │
│  ├── apps/server (:3001)             │
│  └── apps/generator (:3003)          │
└─────────────────────────────────────┘
```

| 维度 | 评估 |
|------|------|
| 复用率 | ⭐⭐⭐⭐⭐ 前后端 100% 复用 |
| 独立性 | ⭐⭐ 不能独立运行，用户需手动启动 server 和 generator |
| 复杂度 | ⭐⭐⭐⭐⭐ 最简单 |
| 教学价值 | ⭐⭐⭐ 一般，壳层太薄 |
| 适用场景 | 开发调试阶段 |

### 方案 C：纯 IPC 模式（绕过 HTTP）

```
┌──────────────────────────────────────┐
│  渲染进程                               │
│  └── window.api.generator.run(input)  │
│       ↓ IPC                            │
├──────────────────────────────────────┤
│  主进程                                 │
│  └── 直接调用 LangChain services       │
│       （绕过 Express 路由层）            │
├──────────────────────────────────────┤
│  无 HTTP、无端口                        │
└──────────────────────────────────────┘
```

| 维度 | 评估 |
|------|------|
| 复用率 | ⭐ 需要重写所有路由层为 IPC handlers |
| 独立性 | ⭐⭐⭐⭐⭐ 完全自包含 |
| 复杂度 | ⭐⭐⭐⭐ 需要维护两套接口（HTTP + IPC） |
| 教学价值 | ⭐⭐ 会让项目架构变得分裂 |
| 数据一致性 | ❌ Web 端和桌面端接口不同，行为可能不一致 |

### 推荐方案：**方案 A（内嵌 BFF + 内嵌前端）**

核心理由：
1. **教学一致性**——Web 端和桌面端走同一套 HTTP API，行为完全一致，学习者不会困惑
2. **零接口维护**——BFF 的路由、中间件、错误处理、限流……全部原生复用，不需要维护一套 IPC handlers
3. **自包含体验**——用户双击桌面图标即可使用，不需要理解"先启动 server"
4. **与薄壳模式兼容**——开发期可以降级为方案 B 调试，生产期切到方案 A

---

## 3. 推荐方案详细设计

### 3.1 进程模型

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron 应用                                │
│                                                                  │
│  ┌─ 主进程 (Main Process, Node.js) ──────────────────────────┐  │
│  │                                                           │  │
│  │  启动流程：                                                │  │
│  │  1. spawn(server.js) → Express 监听随机端口                │  │
│  │  2. 等待 /api/health 返回 200                              │  │
│  │  3. spawn(generator.js) → Nuxt 监听随机端口                │  │
│  │  4. 等待 generator 首页可访问                               │  │
│  │  5. createWindow() → loadURL(`http://localhost:${genPort}`)│  │
│  │                                                           │  │
│  │  退出流程：                                                │  │
│  │  1. BrowserWindow 'closed'                                 │  │
│  │  2. 向 server/generator 子进程发送 SIGTERM                  │  │
│  │  3. 等待子进程优雅退出（最多 10s）                           │  │
│  │  4. app.quit()                                             │  │
│  │                                                           │  │
│  │  IPC Handlers:                                             │  │
│  │  - desktop:chooseDirectory → dialog.showOpenDialog         │  │
│  │  - desktop:saveFile → dialog.showSaveDialog + fs.writeFile │  │
│  │  - desktop:openExternal → shell.openExternal              │  │
│  │  - desktop:getAppInfo → 返回版本号/平台/数据目录路径         │  │
│  │  - server:setApiKey → 向 server 子进程发送新 API Key        │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ 预加载脚本 (Preload Script) ────────────────────────────┐   │
│  │                                                           │   │
│  │  contextIsolation: true, nodeIntegration: false          │   │
│  │                                                           │   │
│  │  window.desktop = {                                       │   │
│  │    chooseDirectory(): Promise<string>                     │   │
│  │    saveFile(filename, content): Promise<boolean>          │   │
│  │    openExternal(url): Promise<void>                       │   │
│  │    getAppInfo(): { version, platform, userDataPath }      │   │
│  │    setApiKey(key): Promise<void>                          │   │
│  │  }                                                        │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ 渲染进程 (Renderer Process, Chromium) ───────────────────┐   │
│  │                                                           │   │
│  │  完整复用 apps/generator 前端代码                           │   │
│  │                                                           │   │
│  │  网络层适配：                                              │   │
│  │  - 开发期：$fetch('/api/xxx') → Vite/Nitro proxy → :3001  │   │
│  │  - 生产期：$fetch('/api/xxx') → Electron 内嵌 server      │   │
│  │                                                           │   │
│  │  桌面特有功能（可选启用）：                                  │   │
│  │  - 导出代码 → window.desktop.saveFile()                   │   │
│  │  - 导入本地组件库 → window.desktop.chooseDirectory()      │   │
│  │  - 查看文档 → window.desktop.openExternal()               │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 `apps/desktop/` 目录结构

```
apps/desktop/
├── package.json                 # name: @ai-study/desktop
├── electron-builder.yml         # 打包配置（可选）
├── src/
│   ├── main/                    # 主进程
│   │   ├── index.ts             # Electron 入口（app.whenReady → 启动子进程 → createWindow）
│   │   ├── spawnServer.ts       # 启动 apps/server 子进程
│   │   ├── spawnGenerator.ts    # 启动 apps/generator 子进程
│   │   ├── ipcHandlers.ts       # IPC 处理器注册
│   │   └── lifecycle.ts         # 退出清理逻辑
│   ├── preload/
│   │   └── index.ts             # contextBridge.exposeInMainWorld('desktop', {...})
│   └── shared/
│       └── ipc-channels.ts      # IPC 频道名常量（主进程和 preload 共享）
├── tsconfig.json
└── resources/                   # 图标等打包资源
    ├── icon.ico
    └── icon.png
```

### 3.3 主进程核心启动流程

```typescript
// src/main/index.ts（伪代码，展示流程）

import { app, BrowserWindow } from 'electron'
import { spawnServer } from './spawnServer.js'
import { spawnGenerator } from './spawnGenerator.js'
import { registerIpcHandlers } from './ipcHandlers.js'

let serverPort: number
let generatorPort: number
let serverProc: ChildProcess
let generatorProc: ChildProcess
let mainWindow: BrowserWindow

app.whenReady().then(async () => {
  // ① 启动 BFF（apps/server）
  serverProc = spawnServer()
  serverPort = await waitForServerReady(serverProc, 3001)  // 等待 /api/health

  // ② 启动前端（apps/generator），注入 BFF 端口
  generatorProc = spawnGenerator({ SERVER_PORT: serverPort })
  generatorPort = await waitForPortReady(generatorProc, 3003)

  // ③ 注册 IPC handlers
  registerIpcHandlers({ serverProc })

  // ④ 创建窗口
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,      // ✅ 安全边界
      nodeIntegration: false,       // ✅ 渲染进程不能直接 require('electron')
    },
  })

  // ⑤ 加载内嵌 generator
  mainWindow.loadURL(`http://localhost:${generatorPort}`)
})

// 退出清理：确保子进程优雅退出
app.on('window-all-closed', () => {
  gracefulShutdown(serverProc, generatorProc)
  app.quit()
})
```

### 3.4 IPC API 设计（preload 暴露层）

```typescript
// src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  /**
   * 让用户选择一个本地目录
   * 用途：导入本地组件库、选择导出目录
   */
  chooseDirectory: () =>
    ipcRenderer.invoke('desktop:chooseDirectory'),

  /**
   * 保存文件到本地（弹保存对话框）
   * 用途：把 AI 生成的 .vue / .tsx 导出到用户指定位置
   */
  saveFile: (filename: string, content: string) =>
    ipcRenderer.invoke('desktop:saveFile', filename, content),

  /**
   * 在系统默认浏览器打开外部链接
   * 用途：查看文档、反馈问题
   */
  openExternal: (url: string) =>
    ipcRenderer.invoke('desktop:openExternal', url),

  /**
   * 获取桌面应用信息
   * 用途：版本号展示、调试
   */
  getAppInfo: () =>
    ipcRenderer.invoke('desktop:getAppInfo'),

  /**
   * 设置 API Key（从渲染进程 → 主进程 → server 子进程）
   * 用途：用户在桌面端设置 API Key，写入 app.getPath('userData')/.env
   */
  setApiKey: (key: string) =>
    ipcRenderer.invoke('server:setApiKey', key),
})
```

**设计约束**：
- preload 是唯一能让渲染进程访问 Electron 能力的入口
- 渲染进程**永远不能**直接 `import 'electron'` 或 `require('electron')`
- 所有 IPC 通信必须用 `ipcRenderer.invoke()`（request-response 模式），避免 fire-and-forget 丢失消息
- 频道名统一用命名空间前缀（`desktop:` / `server:`），避免冲突

### 3.5 数据层策略（与数据库选型的衔接）

#### SQLite 阶段（当前）

```
开发期：apps/server/data/knowledge.db
生产期：app.getPath('userData')/data/knowledge.db
       ↑ Electron 自动隔离的用户数据目录
```

**关键适配点**：server 子进程启动时，通过环境变量注入 db 路径：
```typescript
// spawnServer.ts
spawn('node', ['dist/index.js'], {
  env: {
    ...process.env,
    DB_PATH: path.join(app.getPath('userData'), 'data', 'knowledge.db'),
  },
})
```

#### PostgreSQL 阶段（未来切换后）

两种部署形态：

| 形态 | 数据库位置 | 适用场景 |
|------|-----------|---------|
| **本地 PG** | 用户电脑上 docker run postgres | 离线可用、数据不外传 |
| **远程 PG** | 云端 PostgreSQL + pgvector | 多设备同步、无需用户装 PG |

**推荐**：先做远程 PG（云托管），Electron 端通过 `SERVER_URL` 环境变量指向云端 BFF；后期再做本地 PG 模式（需要安装引导）。

#### API Key 存储

```
开发期：apps/server/.env（已有 .env.example）
生产期：app.getPath('userData')/.env
       ↑ 主进程通过 IPC 写入，server 子进程读取
       ↑ 加密存储：用 keytar 或 electron-store 做对称加密
```

### 3.6 启动流程时序图

```
Electron 主进程          server 子进程         generator 子进程        渲染进程
    │                        │                      │                    │
    │── spawn(server) ──────▶│                      │                    │
    │                        │── initDatabase()     │                    │
    │                        │── listen(PORT)       │                    │
    │◀── /api/health OK ─────│                      │                    │
    │                        │                      │                    │
    │── spawn(generator) ──────────────────────────▶│                    │
    │   env: SERVER_PORT ──────────────────────────▶│                    │
    │                        │                      │── listen(PORT)    │
    │◀── 首页可访问 ────────────────────────────────│                    │
    │                        │                      │                    │
    │── createWindow() ─────────────────────────────────────────────────▶│
    │   loadURL(generator) ─────────────────────────────────────────────▶│
    │                        │                      │                    │
    │                        │                      │    ← 用户操作 →     │
    │                        │◀── HTTP /api/xxx ────│◀── fetch('/api') ─│
    │                        │── LangChain 处理     │                    │
    │                        │── SQLite/PG 查询     │                    │
    │                        │── SSE 响应 ──────────│── SSE 流 ─────────▶│
```

---

## 4. 设计约束（从踩坑经验提取）

> 以下每条都来自真实踩过的坑，**必须遵守**，否则会导致难以排查的问题。

### 约束 1：数据库路径硬编码 = 定时炸弹 ❌

| 踩坑 | 表现 | 根因 |
|------|------|------|
| SQLITE_NOTADB 报错 | 启动时 db.prepare() 抛异常 | db 路径指向了非 SQLite 文件（可能是 `.gitkeep` 或之前打包残留） |
| 生产环境数据丢失 | 升级应用后旧数据找不到 | 开发期硬编码 `./data/knowledge.db`，生产期这个路径不存在 |

**✅ 正确做法**：
```typescript
// 永远通过环境变量传入 db 路径
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, 'data', 'knowledge.db')

// Electron 主进程 spawn server 时注入
spawn('node', ['dist/index.js'], {
  env: {
    DB_PATH: path.join(app.getPath('userData'), 'data', 'knowledge.db'),
  },
})
```

### 约束 2：渲染进程不能直接碰 Node/Electron ❌

| 踩坑 | 表现 | 根因 |
|------|------|------|
| webpack/vite 打包崩溃 | `Cannot find module 'electron'` | 渲染层代码里直接 `import { ipcRenderer } from 'electron'`，被打包器当作浏览器依赖解析 |
| require is not defined | 浏览器预览正常但 Electron 里报错 | `nodeIntegration: false` 下渲染进程没有 Node API |

**✅ 正确做法**：
```
❌ 渲染进程里：import { ipcRenderer } from 'electron'
✅ 渲染进程里：window.desktop.saveFile('test.vue', code)
                ↑ preload 脚本已经提前注入好
```

### 约束 3：IPC 通信必须走 preload 桥接 ❌

| 踩坑 | 表现 | 根因 |
|------|------|------|
| 安全边界混乱 | 每个组件自己写 `window.require('electron')` | 没有统一的 preload 暴露层 |
| 调试困难 | 谁都能发 IPC 消息，日志满天飞 | 没有命名空间，频道名冲突 |

**✅ 正确做法**：
```
1. 所有 Electron 能力只在 preload/index.ts 暴露一次
2. 频道名必须加命名空间前缀：desktop:*、server:*
3. 渲染进程只调用 window.desktop.xxx，完全不碰 ipcRenderer
4. 新增能力 → 改 preload → 改 main ipcHandlers → 渲染进程用 window.desktop.newMethod()
```

### 约束 4：进程退出必须优雅清理 ❌

| 踩坑 | 表现 | 根因 |
|------|------|------|
| 应用卡死在退出 | 进程关了但服务器还占着端口 | 子进程没收到 SIGTERM，主进程直接 exit |
| 数据库 WAL 文件损坏 | 强制 kill 导致 SQLite WAL 没刷盘 | 退出太快，没等 WAL checkpoint 完成 |

**✅ 正确做法**：
```typescript
// 1. 主进程监听所有退出事件
app.on('before-quit', () => gracefulShutdown())
app.on('window-all-closed', () => gracefulShutdown())

// 2. 给子进程发 SIGTERM，等 10s 超时后 SIGKILL
async function gracefulShutdown() {
  serverProc?.kill('SIGTERM')
  generatorProc?.kill('SIGTERM')

  // 给 server 时间完成 WAL checkpoint
  await Promise.race([
    Promise.all([waitExit(serverProc), waitExit(generatorProc)]),
    sleep(10000),
  ])
}
```

### 约束 5：API Key 不能写死在源码里 ❌

| 踩坑 | 表现 | 根因 |
|------|------|------|
| git history 泄露 | API Key 被提交到 git | 开发期图省事写在 .env 忘了 .gitignore |
| 打包进 asar | 解压 asar 就能看到 Key | Electron 打包把 .env 塞进了 asar 文件 |

**✅ 正确做法**：
```
1. 开发期：.env 文件 + .gitignore 排除（当前已有）
2. 生产期：API Key 存储在 app.getPath('userData') 下，不进 asar
3. 用户设置入口：Electron 设置页 → window.desktop.setApiKey(key) → 主进程写入 .env
4. 可选加密：用 keytar 或 electron-store 做额外保护
```

---

## 5. 复用关系总结

```
apps/desktop/           复用来源                     复用率
─────────────────────────────────────────────────────────────
src/main/index.ts       Electron 框架本身（独立新写）      0%
src/main/spawnServer.ts spawn apps/server 子进程          100%（server 代码零修改）
src/preload/index.ts    Electron preload（独立新写）       0%
                                                      
渲染进程 →              apps/generator/                 100%
  HTTP /api/chat          apps/server/routes/chat.ts    100%
  HTTP /api/rag/xxx       apps/server/routes/rag.ts     100%
  HTTP /api/agent/xxx     apps/server/routes/agent.ts   100%
  HTTP /api/generator/xxx apps/server/routes/generator.ts 100%
  LangChain services      apps/server/services/*        100%
  SQLite / (未来 PG)      apps/server/src/db/index.ts   适配路径即可
  shared types            packages/shared               100%

window.desktop.xxx      Electron 原生能力（新写）          0%
```

**总复用率预估：90%+**

---

## 6. 开发阶段规划

```
Phase 0：设计文档（当前）  ✅ 本文件
  └── 等待 generator 前端 + SSR 主线就绪

Phase 1：Electron 最小壳（仅主进程 + preload）
  ├── 创建 apps/desktop/package.json
  ├── 创建 src/main/index.ts（加载现有 :3003）
  ├── 创建 src/preload/index.ts（基础 expose）
  ├── 验证：Electron 窗口能显示 generator
  └── 数据库：临时用开发期路径（先跑通）

Phase 2：内嵌 BFF（方案 A 完整形态）
  ├── spawnServer.ts：fork apps/server
  ├── spawnGenerator.ts：fork apps/generator
  ├── 数据库路径：app.getPath('userData') 适配
  ├── 优雅退出：SIGTERM + WAL checkpoint 等待
  └── 验证：双击 Electron 图标 → 自动启动 server → 自动加载前端

Phase 3：桌面特有功能
  ├── 设置页（API Key 存储 / 切换模型）
  ├── 导出功能（window.desktop.saveFile）
  ├── 导入本地组件库（window.desktop.chooseDirectory）
  ├── 自动更新（electron-updater）
  └── 打包（electron-builder + 代码签名）

Phase 4：数据库升级（与 Web 端同步）
  ├── 先切换 server 端：SQLite → Drizzle ORM（不改存储引擎）
  ├── 再切换存储引擎：SQLite → PostgreSQL（本地或远程）
  ├── Electron 端只需改环境变量，主进程代码零修改
  └── pgvector 向量检索对桌面端透明（全在 server 内部）
```

---

## 7. 与项目记忆中的"方案预留"的关系

项目记忆中提到：

> Electron 桌面端按「最通用方案 A」预留规划，当前阶段不开发、不初始化、不写入任何实际代码

本文档定义的"方案 A"就是那个"最通用方案 A"——**内嵌 BFF + 内嵌前端 + preload 桥接**。它的核心承诺是：

1. **壳层零业务逻辑**——所有业务代码都在 server + generator 里
2. **壳层零接口维护**——复用 HTTP API，不维护 IPC handlers 做业务
3. **壳层唯一职责**——启动子进程、暴露桌面原生能力、管理生命周期

这样当用户双击桌面图标时，背后跑的是和 Web 端一模一样的 Express + LangChain + Nuxt。
