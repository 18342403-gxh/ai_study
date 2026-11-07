-- ========================================
-- 初始化 ai_study 数据库（不含 pgvector）
-- pgvector 装好后再执行:
--   CREATE EXTENSION IF NOT EXISTS vector;
-- ========================================

-- pgvector 暂时跳过（扩展没装），后面手动装
-- CREATE EXTENSION IF NOT EXISTS vector;

-- 创建业务 schema
CREATE SCHEMA IF NOT EXISTS app;

-- 授权 ai_study 用户
GRANT ALL ON SCHEMA app TO ai_study;
GRANT ALL ON ALL TABLES IN SCHEMA app TO ai_study;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app TO ai_study;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON TABLES TO ai_study;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON SEQUENCES TO ai_study;

-- ============================
-- 1. documents（v5 补 user_id / library_id 归属字段）
-- ============================
CREATE TABLE IF NOT EXISTS app.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(512) NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  mime_type VARCHAR(128),
  storage_path VARCHAR(1024) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','ready','failed','deleted')),
  chunk_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NOT NULL DEFAULT 'local';
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS library_id VARCHAR(64) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_documents_status ON app.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON app.documents(created_at);

-- ============================
-- 2. chunks（embedding 暂时用 text，pgvector 装完后改 vector(1536)）
-- ============================
CREATE TABLE IF NOT EXISTS app.chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  embedding TEXT,  -- TODO: pgvector 装好后 ALTER COLUMN embedding TYPE vector(1536) USING NULL;
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extracted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON app.chunks(doc_id);

-- ============================
-- 3. sessions
-- ============================
CREATE TABLE IF NOT EXISTS app.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(256) NOT NULL DEFAULT '新对话',
  model VARCHAR(64) NOT NULL DEFAULT 'glm-4-flash',
  system_prompt TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================
-- 4. messages（v5 补 citations 引用快照）
-- ============================
CREATE TABLE IF NOT EXISTS app.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES app.sessions(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  tool_call_id VARCHAR(128),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app.messages ADD COLUMN IF NOT EXISTS citations JSONB;
CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON app.messages(session_id, created_at);

-- ============================
-- 5. entries — 个人记忆条目（v5 核心）
-- ============================
CREATE TABLE IF NOT EXISTS app.entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(64) NOT NULL DEFAULT 'local',
  library_id VARCHAR(64) NOT NULL DEFAULT 'default',
  type VARCHAR(16) NOT NULL CHECK (type IN ('schedule','plan','fact','note')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','done','archived')),
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  recurrence JSONB,              -- RRULE 子集：freq/interval/byWeekday/byMonthDay/until
  recurrence_until TIMESTAMPTZ,
  exceptions JSONB,              -- 预留：例外实例，本期不使用
  source_type VARCHAR(16) NOT NULL DEFAULT 'conversation'
    CHECK (source_type IN ('conversation','document','manual')),
  source_ref TEXT,               -- 会话 id 或文档 id
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_entries_status_type ON app.entries(status, type);
CREATE INDEX IF NOT EXISTS idx_entries_start ON app.entries(start_at) WHERE start_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_library ON app.entries(library_id, status);

-- ============================
-- 6. entry_embeddings — 条目向量（embedding 暂用 text，pgvector 装完后改 vector(1536)）
-- ============================
CREATE TABLE IF NOT EXISTS app.entry_embeddings (
  entry_id UUID PRIMARY KEY REFERENCES app.entries(id) ON DELETE CASCADE,
  embedding TEXT NOT NULL,
  model VARCHAR(128) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- 7. ai_usage_logs — AI Token 用量日志（成本控制核心）
-- ============================
CREATE TABLE IF NOT EXISTS app.ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature VARCHAR(32) NOT NULL CHECK(feature IN ('chat','generator','rag','embedding','eval')),
  model VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'zhipu',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_ms INTEGER NOT NULL DEFAULT 0,
  user_id VARCHAR(64),
  session_id VARCHAR(64),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON app.ai_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature ON app.ai_usage_logs(feature, created_at);

-- ============================
-- v5 阶段1：组件生成模块已移除，清理旧表
-- ============================
DROP TABLE IF EXISTS app.generator_files;
DROP TABLE IF EXISTS app.generator_sessions;
DROP TABLE IF EXISTS app.tool_calls;
DROP TABLE IF EXISTS app.agent_states;

-- ============================
-- 完成
-- ============================
SELECT '✅ All tables created in app schema' as result;
