# ─────────────────────────────────────────────────────────────
#  AI Study Generator（Nuxt SSR）— 生产 Dockerfile（多阶段）
# ─────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder

# 腾讯云 Alpine 源
RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.tencent.com/alpine|g' /etc/apk/repositories && \
    apk add --no-cache python3 make g++

# 腾讯云 npm/pnpm registry
RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ && \
    npm install -g pnpm@9.15.9 && \
    pnpm config set registry https://mirrors.cloud.tencent.com/npm/

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/generator/package.json apps/generator/

RUN pnpm install --frozen-lockfile --registry=https://mirrors.cloud.tencent.com/npm/

COPY tsconfig.base.json tsconfig.json ./
COPY assets assets

COPY packages/shared packages/shared
COPY apps/generator apps/generator

ARG BFF_URL
ENV BFF_URL=${BFF_URL}

RUN pnpm --filter @ai-study/generator build

# ── 运行阶段 ──
FROM node:20-alpine AS runtime

RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.tencent.com/alpine|g' /etc/apk/repositories

WORKDIR /app/apps/generator

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3003

COPY --from=builder /app/apps/generator/.output ./.output
COPY --from=builder /app/apps/generator/package.json ./

EXPOSE 3003
CMD ["node", ".output/server/index.mjs"]
