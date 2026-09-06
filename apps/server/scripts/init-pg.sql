/**
 * PostgreSQL 数据库初始化脚本
 *
 * 在运行 Drizzle 迁移之前，需要手动执行：
 *   psql -U postgres -d postgres -f scripts/init-pg.sql
 *
 * 这个脚本做三件事：
 *   1. 创建 database（如果不存在）
 *   2. 创建 app schema（业务表 namespace）
 *   3. 启用 pgvector 扩展（在 public schema）
 */

-- 创建 database（已存在则跳过）
SELECT 'CREATE DATABASE ai_study'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_study')\gexec

\c ai_study

-- 启用 pgvector（需要先安装 pgvector 扩展）
-- 如果还没装 pgvector，参考: https://github.com/pgvector/pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 创建业务 schema
CREATE SCHEMA IF NOT EXISTS app;

-- 给当前用户赋权限
-- GRANT ALL ON SCHEMA app TO CURRENT_USER;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app TO CURRENT_USER;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON TABLES TO CURRENT_USER;
