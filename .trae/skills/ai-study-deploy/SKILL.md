---
name: ai-study-deploy
description: Deploy AI Study to the Tencent Cloud Ubuntu production server via Docker Compose. Use when the user says 部署/发布/上线/部署到服务器 or asks to push local code changes to 124.221.233.250. Rebuilds containers and verifies health. Do not use for local dev startup.
---

# AI Study 部署到腾讯云生产服务器

将本地代码部署到 `124.221.233.250`（Ubuntu，三容器：postgres / server / generator）。

## 前置条件（一次性，已就绪则跳过）

- SSH key 在本地：`~/.ssh/deploy-ai-study`，用户 `ubuntu`
- 服务器已装 Docker + Compose v2，镜像加速已配
- 服务器 `/opt/ai-study/.env` 已存在（含 AI_API_KEY / PG_PASSWORD 等，**绝不在本地落盘，绝不上传覆盖**）
- 本地有 `docker-compose.prod.yml`、`apps/server/Dockerfile`、`apps/generator/Dockerfile`

所有命令的 SSH 模板：

```powershell
$key = "$env:USERPROFILE\.ssh\deploy-ai-study"
$host = "ubuntu@124.221.233.250"
ssh -i $key $host "远程命令"
```

## 部署步骤

### 0. 本地确认

- 当前在 `d:\project\ai_study`
- `apps/server/Dockerfile` 已包含 `COPY .npmrc .npmrc` 和 tar 传递 node_modules（见下方「关键设计」）
- `docker-compose.prod.yml` 的 server command 是 `tsx scripts/init-pg.mts && node dist/src/index.js`

### 1. 打包本地完整工作区（含未提交改动）

**绝对不要用 `git archive`** —— 它会丢所有 modified + untracked 文件。用 tar：

```powershell
tar -czf "$env:TEMP\ai-study-full.tar.gz" `
  --exclude='.git' --exclude='node_modules' --exclude='.pnpm-store' `
  --exclude='dist' --exclude='.env' --exclude='.env.prod' --exclude='.env.*.local' `
  --exclude='_*.sh' --exclude='_*.json' --exclude='*.log' `
  --exclude='.trae' --exclude='.kiro' --exclude='.vite' --exclude='.nuxt' --exclude='.output' `
  --exclude='data' --exclude='.screenshots' `
  .
```

预期 ~2.5MB。

### 2. 上传 + 服务器解压覆盖

```powershell
scp -i $key "$env:TEMP\ai-study-full.tar.gz" "$host:/tmp/ai-study-full.tar.gz"
ssh -i $key $host "cd /opt/ai-study && sudo tar -xzf /tmp/ai-study-full.tar.gz --no-same-owner"
```

⚠️ tar 解压会**覆盖**服务器上的 `docker-compose.yml` 成开发版。解压后必须恢复：

```powershell
ssh -i $key $host "cd /opt/ai-study && sudo cp docker-compose.prod.yml docker-compose.yml"
```

### 3. 重建镜像 + 启动

```powershell
ssh -i $key $host "cd /opt/ai-study && sudo docker compose up -d --build"
```

server 首次完整 build 约 5-10 分钟（腾讯云源加速）。后续改源码 rebuild 只跑变化层，~1-2 分钟。

### 4. 验证全绿

```powershell
ssh -i $key $host "sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
ssh -i $key $host "curl -s http://localhost:3001/api/health"
```

预期：

- 三个容器 Up（postgres healthy）
- health 返回 `{"status":"ok",...}`

### 5. （可选）端到端对话验证

```powershell
# 创建会话
ssh -i $key $host "curl -s -X POST http://localhost:3001/api/sessions -H 'Content-Type: application/json' -d '{\"title\":\"t\",\"scope\":\"public\"}'"
# 用返回的 id 发消息（在服务器本地拼 JSON 避免转义问题）
```

## 访问地址（Nginx 反代后，只开 80 端口）

- 前端：`http://124.221.233.250/`（浏览器直接打开）
- API：`http://124.221.233.250/api/...`（同域，免 CORS）
- 3001/3003 已绑定 `127.0.0.1`，不对外暴露，统一走 Nginx 80 端口

## Nginx 反代（已配置，勿重复安装）

配置文件：服务器 `/etc/nginx/sites-available/ai-study`（源文件在项目 `deploy/nginx/ai-study.conf`）

- `/` → `127.0.0.1:3003`（generator / Nuxt SSR）
- `/api/` → `127.0.0.1:3001`（server / Express BFF），关 `proxy_buffering` 支持 SSE 流式，`client_max_body_size 50m` 支持文档上传，超时 180s
- 改完配置：`sudo nginx -t && sudo nginx -s reload`
- `.env` 的 `BFF_URL=http://124.221.233.250`（不带端口，同域），`CORS_ORIGINS=http://124.221.233.250`
- generator compose 里有 `build.args.BFF_URL`（build 时 bake）和运行时 `NUXT_PUBLIC_BFF_URL`（改 .env 重启即生效，免 rebuild）

## 关键设计（不要改坏）

### Server Dockerfile 的 node_modules 传递

pnpm 的 hoisting 是 symlink 结构，Docker `COPY --from=builder node_modules` **会破坏 symlink**，导致运行时报 `ERR_MODULE_NOT_FOUND`。正确做法：

1. builder 阶段先 `COPY .npmrc .npmrc` —— `.npmrc` 里 `node-linker=hoisted`，让所有包平铺到根 node_modules（否则 isolated 模式下 prodDep 不会 hoist）
2. builder 末尾 `tar -cf /tmp/workspace.tar --exclude='apps/generator' --exclude='apps/desktop' .`
3. runtime 阶段 `tar -xf /tmp/workspace.tar -C /app`
4. 入口是 `dist/src/index.js`（tsconfig rootDir="." 决定），不是 `dist/index.js`

### compose server command

```yaml
command: sh -c "/app/node_modules/.bin/tsx scripts/init-pg.mts && node dist/src/index.js"
```

- hoisted 模式下 tsx 在 `/app/node_modules/.bin/tsx`（不是 `.pnpm/node_modules/.bin/`）
- 先跑 init-pg 建表/建扩展，再起 node
- scripts 目录用 bind mount `./apps/server/scripts:/app/apps/server/scripts:ro`，方便热更未跟踪脚本

### 凭据安全

- `.env` 只存在服务器 `/opt/ai-study/.env`，**本地永远不写、不传**
- 改密码时密码必须 URL 安全（不能含 `#` `!` `@` 等，否则 DATABASE_URL 解析失败）。改密码后要 `ALTER USER` + 重建 pgdata volume
- 本地 `.env.prod` 若存在，`.gitignore` 掉，别提交

## 常见故障速查

| 现象                                                   | 根因                              | 处理                                                                    |
| ------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------- |
| `ERR_MODULE_NOT_FOUND: dotenv/zod-to-json-schema`      | node_modules symlink 被 COPY 破坏 | 确认 Dockerfile 用 tar 传递 + COPY 了 .npmrc，`--no-cache` rebuild      |
| `Cannot find module dist/index.js`                     | 入口路径错                        | 改 `dist/src/index.js`                                                  |
| `tsx: not found` 或 `ERR_MODULE_NOT_FOUND init-pg.mts` | tsx 路径错 / 脚本未跟踪           | 用 `/app/node_modules/.bin/tsx`；scripts 加 bind mount                  |
| `Invalid URL` / 密码鉴权失败                           | 密码含 URL 特殊字符               | 改安全密码，`ALTER USER`，`docker compose down -v postgres` 重建 volume |
| `no such service: server`                              | tar 覆盖了 compose.yml            | `cp docker-compose.prod.yml docker-compose.yml`                         |
| server 循环重启                                        | 看上一条日志                      | `sudo docker logs --tail 30 ai-study-server`                            |
| 前端 302 但打不开                                      | CORS / BFF_URL 不匹配             | 改 `.env` 的 CORS_ORIGINS 和 BFF_URL，重建 generator                    |

## 不要做的事

- 不要用 `git archive` 打包（丢未提交文件，服务器跑老代码）
- 不要在 runtime 阶段跑 `pnpm install` 重建 node_modules（会因 husky prepare 失败，且 hoisting 不完整）
- 不要把 `.env` 或密钥写进本地文件再 scp
- 不要 `git commit` 除非用户明确要求
- 不要改服务器 `/opt/ai-study/.env` 除非用户明确要改密钥
