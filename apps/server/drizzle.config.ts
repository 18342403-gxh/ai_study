/**
 * Drizzle Kit 配置
 *
 * 用法：
 *   npx drizzle-kit generate    ← 生成迁移 SQL
 *   npx drizzle-kit migrate      ← 执行迁移（连到真实 PG）
 *   npx drizzle-kit push         ← 直接 push schema 到 PG（开发用，跳过迁移）
 *   npx drizzle-kit studio       ← 启动数据浏览 UI
 *   npx drizzle-kit check:sqlite ← 对比 SQLite（如果还在用）
 */

import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const DB_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/ai_study'

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: DB_URL,
  },
  // 开启 pgvector 扩展支持（让 drizzle-kit 识别 vector 类型）
  // 需要在 PG 里先执行: CREATE EXTENSION IF NOT EXISTS vector;
  schemaFilter: ['public', 'app'],
})
