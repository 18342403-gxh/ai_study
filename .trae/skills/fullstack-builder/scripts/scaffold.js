#!/usr/bin/env node
/**
 * Scaffold Generator — 按 Phase 1 选型生成项目骨架
 * 零依赖 Node.js 脚本。读取 .workflow-state.json 里的 techStack 决定生成什么。
 *
 * 用法:
 *   node scaffold.js run                   读取 .workflow-state.json 并生成骨架
 *   node scaffold.js dry-run               只打印要生成什么，不实际写
 *   node scaffold.js list                  列出支持的 stack 组合
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CWD = process.cwd()
const STATE_PATH = join(CWD, '.workflow-state.json')

// ─── 目录模板 ───────────────────────────────────────────────

function getMonorepoDirs() {
  return [
    'apps/server/src/routes',
    'apps/server/src/services',
    'apps/server/src/db',
    'apps/server/src/middleware',
    'apps/server/public',
    'apps/web/src/pages',
    'apps/web/src/components',
    'apps/web/src/composables',
    'packages/shared/src',
    'docs',
  ]
}

function getSingleAppDirs() {
  return [
    'src/routes',
    'src/services',
    'src/db',
    'src/middleware',
    'public',
    'docs',
  ]
}

function getPythonDirs() {
  return [
    'app/routes',
    'app/services',
    'app/db',
    'app/middleware',
    'tests',
    'docs',
  ]
}

function getGoDirs() {
  return [
    'internal/handlers',
    'internal/services',
    'internal/db',
    'internal/middleware',
    'cmd/server',
    'docs',
  ]
}

// ─── 文件模板 ───────────────────────────────────────────────

const TEMPLATES = {
  'express': {
    'index.ts': `import express from 'express'
import { logger } from './services/logger.js'
import { getDb } from './db/index.js'

const app = express()
const PORT = process.env.PORT || 3001

// 中间件管线（Phase 2 继续填充）
app.use(express.json({ limit: '10mb' }))

// Health check
app.get('/health', async (_req, res) => {
  try {
    const db = getDb()
    await db.exec('SELECT 1')
    res.json({ status: 'ok', uptime: process.uptime(), db: 'ok' })
  } catch (e) {
    res.status(503).json({ status: 'degraded', db: 'fail', error: (e as Error).message })
  }
})

app.listen(PORT, () => {
  logger.info('server', \`Listening on :\${PORT}\`)
})
`,
    'db/index.ts': `// DB Facade — 根据 DATABASE_DRIVER 切换
// 参考 references/db-patterns.md
export interface AsyncPrepared {
  run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: bigint | number | null }>
  get<T = unknown>(...params: unknown[]): Promise<T | undefined>
  all<T = unknown>(...params: unknown[]): Promise<T[]>
}
export interface AsyncDb { prepare(sql: string): AsyncPrepared; exec(sql: string): Promise<unknown> }

export function getDb(): AsyncDb {
  const driver = process.env.DATABASE_DRIVER || 'sqlite'
  if (driver === 'postgres') return getPgDb()
  return getSqliteDb()
}

function getSqliteDb(): AsyncDb {
  // Phase 2 实现: better-sqlite3 → async wrapper
  throw new Error('SQLite driver not implemented yet — Phase 2')
}

function getPgDb(): AsyncDb {
  // Phase 2 实现: postgres.js client wrapper
  throw new Error('PostgreSQL driver not implemented yet — Phase 2')
}
`,
    'services/logger.ts': `// 结构化 Logger — 禁止 console.log
// 参考 references/backend-patterns.md#4
type LogRecord = {
  level: 'debug' | 'info' | 'warn' | 'error'
  tag: string
  requestId?: string
  message: string
  data?: Record<string, unknown>
  timestamp: number
}

function emit(record: LogRecord) {
  const line = [
    new Date(record.timestamp).toISOString(),
    record.level.toUpperCase().padEnd(5),
    \`[\${record.tag}]\`,
    record.requestId ? \`(rid=\${record.requestId})\` : '',
    record.message,
    record.data ? JSON.stringify(record.data) : '',
  ].filter(Boolean).join(' ')
  process.stdout.write(line + '\\n')
}

export const logger = {
  debug: (tag: string, message: string, data?: Record<string, unknown>) => emit({ level: 'debug', tag, message, data, timestamp: Date.now() }),
  info:  (tag: string, message: string, data?: Record<string, unknown>) => emit({ level: 'info',  tag, message, data, timestamp: Date.now() }),
  warn:  (tag: string, message: string, data?: Record<string, unknown>) => emit({ level: 'warn',  tag, message, data, timestamp: Date.now() }),
  error: (tag: string, message: string, data?: Record<string, unknown>) => emit({ level: 'error', tag, message, data, timestamp: Date.now() }),
}
`,
    'middleware/validate.ts': `// Zod 校验中间件
// 参考 references/backend-patterns.md#1
import type { Request, Response, NextFunction } from 'express'
import { z, ZodError } from 'zod'

export function validate<T>(schemas: { body?: z.ZodType<T>; query?: z.ZodType<T>; params?: z.ZodType<T> }) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body)   req.body   = schemas.body.parse(req.body)
      if (schemas.query)  req.query  = schemas.query.parse(req.query)
      if (schemas.params) req.params = schemas.params.parse(req.params)
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ ok: false, error: 'Validation failed', details: err.flatten() })
      } else {
        next(err)
      }
    }
  }
}
`,
  },

  'fastapi': {
    'main.py': `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="{{project_name}}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "db": "todo"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(__import__("os").environ.get("PORT", 3001)))
`,
  },
}

// ─── 生成逻辑 ───────────────────────────────────────────────

function generate(stack, opts = {}) {
  const dryRun = opts.dryRun || false
  const created = []

  // 1. 目录
  let dirs
  const layout = stack.layout || 'single-package'
  const backend = stack.backend || 'express'

  if (['fastapi', 'flask'].includes(backend)) dirs = getPythonDirs()
  else if (['gin', 'fiber'].includes(backend)) dirs = getGoDirs()
  else if (layout.includes('monorepo')) dirs = getMonorepoDirs()
  else dirs = getSingleAppDirs()

  // app/server 前缀（monorepo 的 server 目录）
  const isMonorepo = layout.includes('monorepo')
  const prefix = isMonorepo ? 'apps/server/' : ''

  // 1.5 Monorepo 根配置（pnpm-workspace.yaml + root package.json）
  if (isMonorepo && !existsSync(join(CWD, 'pnpm-workspace.yaml'))) {
    if (!dryRun) {
      writeFileSync(join(CWD, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n')
      writeFileSync(join(CWD, 'package.json'), JSON.stringify({
        name: stack.projectName || 'my-app',
        private: true,
        scripts: {
          'dev:server': 'pnpm --filter server dev',
          'dev:web':    'pnpm --filter web dev',
          'dev':        'concurrently -k "pnpm dev:server" "pnpm dev:web"',
          'build':      'pnpm -r build',
          'typecheck':  'pnpm -r typecheck',
        },
        devDependencies: { concurrently: '^9.0.0' },
        packageManager: 'pnpm@9',
      }, null, 2) + '\n')
    }
    created.push('📄 pnpm-workspace.yaml')
    created.push('📄 package.json (root)')

    // server package.json
    if (!existsSync(join(CWD, prefix + 'package.json'))) {
      if (!dryRun) writeFileSync(join(CWD, prefix + 'package.json'), JSON.stringify({
        name: 'server', version: '0.1.0', private: true, type: 'module',
        scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js', typecheck: 'tsc --noEmit' },
        dependencies: { express: '^5.0.0', 'better-sqlite3': '^11.0.0', zod: '^3.23.0', 'cors': '^2.8.5' },
        devDependencies: { '@types/express': '^5.0.0', '@types/better-sqlite3': '^7.6.0', '@types/cors': '^2.8.0', '@types/node': '^22.0.0', tsx: '^4.0.0', typescript: '^5.5.0' },
      }, null, 2) + '\n')
      created.push('📄 apps/server/package.json')
    }

    // web package.json (Vite + Vue)
    if (!existsSync(join(CWD, 'apps/web/package.json'))) {
      if (!dryRun) writeFileSync(join(CWD, 'apps/web/package.json'), JSON.stringify({
        name: 'web', version: '0.1.0', private: true, type: 'module',
        scripts: { dev: 'vite', build: 'vue-tsc && vite build', preview: 'vite preview', typecheck: 'vue-tsc --noEmit' },
        dependencies: { vue: '^3.5.0', pinia: '^2.2.0', axios: '^1.7.0' },
        devDependencies: { '@vitejs/plugin-vue': '^5.1.0', typescript: '^5.5.0', vite: '^5.4.0', 'vue-tsc': '^2.1.0' },
      }, null, 2) + '\n')
      created.push('📄 apps/web/package.json')
    }
  }

  for (const d of dirs) {
    const fullPath = join(CWD, prefix + d)
    if (!existsSync(fullPath)) {
      if (!dryRun) mkdirSync(fullPath, { recursive: true })
      created.push(`📁 ${d}/`)
    }
  }

  // 2. .env.example
  const envPath = join(CWD, '.env.example')
  if (!existsSync(envPath)) {
    const env = [
      '# Server',
      'PORT=3001',
      'NODE_ENV=development',
      '',
      '# Database',
      `DATABASE_DRIVER=${stack.database === 'sqlite' ? 'sqlite' : 'postgres'}`,
      'DATABASE_URL=postgresql://user:pass@localhost:5432/app',
      '',
      '# LLM',
      'LLM_API_KEY=your-key-here',
      'LLM_MODEL=glm-4-flash',
      '',
      '# Embedding',
      'EMBEDDING_MODEL=embedding-3',
      '# ENABLE_MOCK_EMBEDDING=1',
      '# DISABLE_EMBEDDING_FALLBACK=1',
      '',
      '# Cost Control',
      '# DAILY_BUDGET_USD=5',
      '',
      '# Workflow',
      '# AUTO_OPEN_DEBUG_PAGES=1',
    ].join('\n')
    if (!dryRun) writeFileSync(envPath, env + '\n')
    created.push('📄 .env.example')
  }

  // 3. 核心文件
  const files = TEMPLATES[backend] || TEMPLATES['express']
  for (const [filename, content] of Object.entries(files)) {
    const fullPath = join(CWD, prefix + filename)
    if (!existsSync(fullPath)) {
      // 替换项目名占位符
      const finalContent = content.replace(/\{\{project_name\}\}/g, stack.projectName || 'my-app')
      if (!dryRun) writeFileSync(fullPath, finalContent)
      created.push(`📄 ${prefix}${filename}`)
    }
  }

  return created
}

// ─── CLI ───────────────────────────────────────────────────

const [, , cmd] = process.argv

if (cmd === 'list') {
  console.log(`
Scaffold Generator — 支持的组合:

Backend:  express / fastify / hono / fastapi / gin / fiber
Database: sqlite / postgresql / mongodb
Frontend: vite+vue / nuxt / vite+react / next
Layout:   single-package / monorepo-noshared / monorepo-shared

示例:
  state.js set techStack.backend express
  state.js set techStack.database sqlite
  state.js set techStack.layout monorepo-noshared
  scaffold.js dry-run    ← 先看要生成什么
  scaffold.js run        ← 真正生成
`)
  process.exit(0)
}

if (!existsSync(STATE_PATH)) {
  console.error('❌ .workflow-state.json 不存在')
  console.error('   先运行: node state.js init <project-name>')
  process.exit(1)
}

const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
const created = generate({ ...state.techStack, projectName: state.project }, { dryRun: cmd === 'dry-run' })

console.log(`\n${cmd === 'dry-run' ? '📋 [DRY-RUN] 将生成:' : '✅ 生成完成:'}`)
console.log('─'.repeat(50))
for (const c of created) console.log(`  ${c}`)
console.log(`\n共 ${created.length} 项`)

if (cmd === 'dry-run') {
  console.log('\n运行 node scaffold.js run 实际生成')
} else {
  console.log('\n下一步: 执行 npm install / pnpm install / pip install 安装依赖')
}
