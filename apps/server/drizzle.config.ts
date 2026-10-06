/**
 * Drizzle Kit 配置
 *
 * 双驱动支持（通过 DATABASE_DRIVER 环境变量）：
 *   DATABASE_DRIVER=postgres  — dialect: postgresql, url: DATABASE_URL
 *   DATABASE_DRIVER=sqlite    — dialect: sqlite, url: DATABASE_SQLITE_PATH
 *
 * 用法：
 *   DATABASE_DRIVER=postgres npx drizzle-kit generate   ← 生成 PG 迁移 SQL
 *   DATABASE_DRIVER=sqlite   npx drizzle-kit generate   ← 生成 SQLite schema
 *   npx drizzle-kit migrate                              ← 执行迁移（连到真实 DB）
 *   npx drizzle-kit push                                ← 直接 push schema（开发用）
 *   npx drizzle-kit studio                              ← 启动数据浏览 UI
 *   npx drizzle-kit check:sqlite                        ← 对比 SQLite schema
 */

import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const DRIVER = process.env.DATABASE_DRIVER || 'postgres'

const base = {
  schema: './drizzle/schema.ts',
  out: './drizzle',
}

const config =
  DRIVER === 'sqlite'
    ? defineConfig({
        ...base,
        dialect: 'sqlite',
        dbCredentials: {
          url: process.env.DATABASE_SQLITE_PATH || './dev.db',
        },
      })
    : defineConfig({
        ...base,
        dialect: 'postgresql',
        dbCredentials: {
          url: process.env.DATABASE_URL || 'postgresql://localhost:5432/ai_study',
        },
        // 开启 pgvector 扩展支持（让 drizzle-kit 识别 vector 类型）
        // 需要在 PG 里先执行: CREATE EXTENSION IF NOT EXISTS vector;
        schemaFilter: ['public', 'app'],
      })

export default config
