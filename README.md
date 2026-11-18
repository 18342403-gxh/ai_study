# AI Study · 个人知识库

对话与文档驱动的个人知识库。可以用自然语言记录日程、规划、事实和笔记，也可以上传文档，再通过带引用的问答找回这些信息。

前端采用 Nuxt 3，服务端采用 Express + LangChain，默认使用 SQLite，也支持 PostgreSQL + pgvector。所有模型调用都在服务端完成，API Key 不会暴露到浏览器。

## 主要功能

### 对话记录与整理

- 通过「记一下」模式或“帮我记”“提醒我”等自然语言，将内容整理为日程、规划、事实或笔记。
- 入库前展示候选卡片，可修改、确认或忽略；多条记录可批量确认。
- 支持用自然语言修改、取消或删除已有记录，例如“把周会改到周二上午十点”。
- 使用 GoldenMatch 关联不同来源、不同条目类型中的同一实体。高置信匹配自动合并，疑似匹配只提示；合并时保留新增事实和来源，不再用长文本覆盖短文本。

### 文档资料库

- 支持 `.txt`、`.md`、`.json`、`.pdf`、`.doc`、`.docx`，单文件最大 10MB。
- 可从对话输入框、拖拽区域或文档页上传，也可粘贴网页 URL 导入。
- 文档解析后自动分块并建立检索索引；处理失败的文档可以重新解析。
- 可直接针对文档提问，也可将文档内容提取为记录，确认后入库。

### 检索问答与引用

- 融合时间、个人条目和文档片段三路检索，再结合 BM25、向量检索与 RRF 排序。
- 个人资料命中时返回带引用的回答，点击引用可查看对应记录或文档片段。
- 对话条目与文档内容可以共同进入回答上下文，避免只返回其中一种来源。
- 未命中个人资料时可回退到通用问答；支持联网搜索、时间、计算、网页读取、天气和新闻等工具。

### 日程、规划与提醒

- 日程页提供双周或月度日历视图，支持重复日程、悬浮详情、编辑、完成和删除。
- 长期事实集中显示在日程页顶部，可展开查看和编辑。
- 规划页按进行中、已完成、已搁置分类管理。
- 对话页展示今天和明天的应用内提醒。

## 安装与启动

### 1. 环境要求

- Node.js 18.20.x LTS
- pnpm 9.15.9
- 可选：PostgreSQL 17 + pgvector 0.8.x（仅使用 PostgreSQL 时需要）

### 2. 安装依赖

```bash
git clone https://github.com/18342403-gxh/ai_study.git
cd ai_study
npx pnpm@9.15.9 install --no-frozen-lockfile
```

Windows 如遇 `ERR_PNPM_EPERM`，可使用项目内 pnpm store：

```bash
npx pnpm@9.15.9 install --no-frozen-lockfile --store-dir=node_modules/.pnpm-store
```

### 3. 配置环境变量

复制服务端配置模板：

```bash
# macOS / Linux
cp apps/server/.env.example apps/server/.env

# Windows
copy apps\server\.env.example apps\server\.env
```

编辑 `apps/server/.env`，至少填写模型密钥：

```env
AI_API_URL=https://open.bigmodel.cn/api/paas/v4
AI_API_KEY=你的真实密钥
AI_MODEL=glm-4-flash
EMBEDDING_MODEL=embedding-3

# 默认使用 SQLite，无需额外安装数据库
DATABASE_DRIVER=sqlite
```

`AI_API_URL` 可替换为其他兼容 OpenAI 协议的服务地址，并同步调整模型名称。若 Embedding 使用不同厂商，可单独配置 `EMBEDDING_API_URL` 和 `EMBEDDING_API_KEY`。

如需使用 PostgreSQL：

```env
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/ai_study
```

目标数据库需要启用 pgvector 扩展。完整配置项见 `apps/server/.env.example`。

> `.env` 已被 Git 忽略。不要提交真实密钥；如果密钥曾经泄露，请立即重新生成。

### 4. 启动开发环境

```bash
pnpm dev
```

启动后访问：

| 服务           | 地址                                |
| -------------- | ----------------------------------- |
| 个人知识库     | http://localhost:3003/              |
| 服务端健康检查 | http://localhost:3001/api/health    |
| 实时日志       | http://localhost:3001/api/logs-view |

首页会自动进入对话页。也可以分别启动前后端：

```bash
pnpm dev:server
pnpm dev:generator
```

## 日常使用

### 记录一条信息

1. 打开「对话」。
2. 点击输入框旁的「记一下」，或直接输入“提醒我”“帮我记”等指令。
3. 输入内容，例如“每周一上午九点开周会”或“张三是一位全栈开发”。
4. 检查系统整理出的卡片，必要时点击「修改」。
5. 点击「确认入库」；存在多条候选时也可点击「全部确认」。
6. 若提示与已有记录相关，核对判重提示后再确认。高置信的同一实体会合并更新，新增事实和来源会保留在记录中。

### 上传资料并提问

1. 点击输入框旁的「+」，选择「上传文件」或「粘贴链接」；也可以直接把文件拖进对话页。
2. 等待文档状态变为「已就绪」。
3. 直接询问资料内容，例如“这份简历里有哪些项目经历？”或“龚熙皓是谁？”。
4. 查看回答下方的引用，点击可核对原始记录或文档片段。
5. 如需把资料转成日程、规划或长期事实，可进入「文档」页，点击「提取为记录」，逐条确认。

### 管理已有信息

- 修改记录：输入“把周会改到周二上午十点”等指令，或在日程、规划页面点击「编辑」。
- 取消或删除：输入“取消周五的聚餐”“删除这条记录”，或在对应页面操作。
- 查看日程：进入「日程」，点击日期格中的事项；一天超过 3 条时可展开「+N 更多」。
- 管理规划：进入「规划」，切换进行中、已完成、已搁置，或编辑、恢复、删除规划。
- 查看提醒：回到「对话」，展开顶部今天或明天的提醒。

## 常用命令

| 命令                                  | 作用                     |
| ------------------------------------- | ------------------------ |
| `pnpm dev`                            | 同时启动前端和服务端     |
| `pnpm dev:server`                     | 仅启动服务端，端口 3001  |
| `pnpm dev:generator`                  | 仅启动前端，端口 3003    |
| `pnpm build`                          | 构建共享包和服务端       |
| `pnpm typecheck`                      | 执行各子项目类型检查     |
| `pnpm lint`                           | 执行 ESLint 检查         |
| `pnpm --filter @ai-study/server test` | 执行服务端测试           |
| `pnpm check:readme`                   | 检查 README 是否需要同步 |

## 常见问题

### 页面无法访问或接口请求失败

先确认两个进程都已启动，并检查 http://localhost:3001/api/health 是否返回正常。前端默认请求 `http://localhost:3001`，需要修改时可设置 `BFF_URL`。

### 模型返回 401、余额不足或调用失败

检查 `apps/server/.env` 中的 `AI_API_URL`、`AI_API_KEY` 和模型名称是否匹配。Embedding 服务暂时不可用时会降级为关键词检索，页面会显示提示；恢复真实 Embedding 服务后可重建语义索引。

### 文档一直显示解析中或解析失败

在「文档」页查看具体错误并点击「重新解析」。请确认文件未损坏、大小不超过 10MB；扫描版 PDF 的识别效果取决于页面清晰度。

### 需要排查一次问答或入库请求

打开 http://localhost:3001/api/logs-view，按请求 ID、日志级别或标签查看服务端、数据库和模型调用日志。
