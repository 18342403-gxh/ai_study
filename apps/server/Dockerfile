# ─────────────────────────────────────────────────────────────
#  AI Study Server — 生产 Dockerfile（多阶段构建）
#  针对腾讯云 Ubuntu 优化：Alpine 源 + npm/pnpm 走国内镜像
#  关键：COPY .npmrc 开启 hoisted 模式，tar 打包完整保留 symlink
# ─────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder

# ── 腾讯云 Alpine 源 ──
RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.tencent.com/alpine|g' /etc/apk/repositories && \
    apk add --no-cache python3 make g++ curl ca-certificates tar

# ── pnpm + npm registry 走腾讯云 ──
RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ && \
    npm install -g pnpm@9.15.9 && \
    pnpm config set registry https://mirrors.cloud.tencent.com/npm/

WORKDIR /app

# 先拷 workspace 清单 + .npmrc（开启 hoisted 模式，prodDep 也会 hoist 到根 node_modules）
COPY .npmrc .npmrc
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

RUN pnpm install --frozen-lockfile --ignore-scripts --registry=https://mirrors.cloud.tencent.com/npm/

# 根目录 tsconfig（被 apps/server/tsconfig.json 和 packages/shared/tsconfig.json 继承）
COPY tsconfig.base.json tsconfig.json ./

# 再拷源码
COPY packages/shared packages/shared
COPY apps/server apps/server

# 编译
RUN pnpm --filter @ai-study/shared build && \
    pnpm --filter @ai-study/server build

# ★ 关键：tar 打包整个项目（包含根 node_modules + server/node_modules + shared/node_modules）
# 用 -c symlinks 保留所有 symlink，pnpm hoisted/isolated 结构完整保留
RUN cd /app && tar -cf /tmp/workspace.tar \
    --exclude='apps/generator' \
    --exclude='apps/desktop' \
    --exclude='.git' \
    --exclude='**/*.test.*' \
    --exclude='**/__tests__' \
    .

# ── 运行阶段 ──
FROM node:20-alpine AS runtime

RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.tencent.com/alpine|g' /etc/apk/repositories

ENV NODE_ENV=production

WORKDIR /app

# ★ 从 builder 拿打包好的 workspace，完整解压保留 symlink
COPY --from=builder /tmp/workspace.tar /tmp/
RUN tar -xf /tmp/workspace.tar -C /app && rm /tmp/workspace.tar

EXPOSE 3001
WORKDIR /app/apps/server
CMD ["node", "dist/src/index.js"]
