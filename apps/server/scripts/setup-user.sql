-- ========================================
-- 初始化 ai_study 数据库
-- 用 postgres 超管执行一次即可
-- ========================================

-- 1. 创建用户
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_study') THEN
    CREATE ROLE ai_study WITH LOGIN PASSWORD '123456';
  ELSE
    ALTER ROLE ai_study WITH LOGIN PASSWORD '123456';
  END IF;
END
$$;

-- 2. 创建数据库
SELECT 'CREATE DATABASE ai_study OWNER ai_study'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_study')\gexec

-- 3. 授权
GRANT ALL PRIVILEGES ON DATABASE ai_study TO ai_study;
