-- ai_study 唯一结构初始化脚本：PostgreSQL + pgvector。
-- 可重复执行；任何扩展、类型转换或约束错误都会使命令失败。
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(512) NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  mime_type VARCHAR(128),
  storage_path VARCHAR(1024) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','ready','failed','deleted')),
  chunk_count INTEGER DEFAULT 0,
  user_id VARCHAR(64) NOT NULL DEFAULT 'local',
  library_id VARCHAR(64) NOT NULL DEFAULT 'default',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NOT NULL DEFAULT 'local';
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS library_id VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS storage_path VARCHAR(1024) NOT NULL DEFAULT '';
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE app.documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_documents_status ON app.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON app.documents(created_at);
CREATE INDEX IF NOT EXISTS idx_documents_library ON app.documents(library_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  embedding vector(1536),
  embedding_type VARCHAR(16) NOT NULL DEFAULT 'real',
  embedding_model VARCHAR(64) NOT NULL DEFAULT 'embedding-3',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extracted_at TIMESTAMPTZ
);
ALTER TABLE app.chunks ADD COLUMN IF NOT EXISTS token_count INTEGER;
ALTER TABLE app.chunks ADD COLUMN IF NOT EXISTS embedding_type VARCHAR(16) NOT NULL DEFAULT 'real';
ALTER TABLE app.chunks ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(64) NOT NULL DEFAULT 'embedding-3';
ALTER TABLE app.chunks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE app.chunks ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'chunks' AND column_name = 'embedding'
      AND udt_name <> 'vector'
  ) THEN
    ALTER TABLE app.chunks
      ALTER COLUMN embedding TYPE vector(1536)
      USING CASE WHEN embedding IS NULL THEN NULL ELSE embedding::vector(1536) END;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON app.chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON app.chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(64) NOT NULL DEFAULT 'local',
  title VARCHAR(256) NOT NULL DEFAULT '新对话',
  model VARCHAR(64) NOT NULL DEFAULT 'glm-4-flash',
  system_prompt TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE app.sessions ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NOT NULL DEFAULT 'local';
ALTER TABLE app.sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE app.sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON app.sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS app.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES app.sessions(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  tool_call_id VARCHAR(128),
  citations JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app.messages ADD COLUMN IF NOT EXISTS tool_call_id VARCHAR(128);
ALTER TABLE app.messages ADD COLUMN IF NOT EXISTS citations JSONB;
CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON app.messages(session_id, created_at);

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
  recurrence JSONB,
  recurrence_until TIMESTAMPTZ,
  exceptions JSONB,
  source_type VARCHAR(16) NOT NULL DEFAULT 'conversation'
    CHECK (source_type IN ('conversation','document','manual')),
  source_ref TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_entries_status_type ON app.entries(status, type);
CREATE INDEX IF NOT EXISTS idx_entries_start ON app.entries(start_at) WHERE start_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_library ON app.entries(library_id, status);

CREATE TABLE IF NOT EXISTS app.entry_embeddings (
  entry_id UUID PRIMARY KEY REFERENCES app.entries(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  model VARCHAR(128) NOT NULL,
  embedding_type VARCHAR(16) NOT NULL DEFAULT 'real',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app.entry_embeddings ADD COLUMN IF NOT EXISTS embedding_type VARCHAR(16) NOT NULL DEFAULT 'real';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'entry_embeddings' AND column_name = 'embedding'
      AND udt_name <> 'vector'
  ) THEN
    ALTER TABLE app.entry_embeddings
      ALTER COLUMN embedding TYPE vector(1536)
      USING embedding::vector(1536);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_entry_embeddings_embedding_hnsw
  ON app.entry_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS app.ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature VARCHAR(32) NOT NULL,
  model VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'zhipu',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_ms INTEGER NOT NULL DEFAULT 0,
  cost DOUBLE PRECISION,
  user_id VARCHAR(64),
  session_id VARCHAR(64),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app.ai_usage_logs ADD COLUMN IF NOT EXISTS cost DOUBLE PRECISION;
ALTER TABLE app.ai_usage_logs DROP CONSTRAINT IF EXISTS ai_usage_logs_feature_check;
UPDATE app.ai_usage_logs
SET feature = CASE
  WHEN feature IN ('chat_general','chat_with_records','extract','understand','embedding','eval') THEN feature
  WHEN feature = 'rag' THEN 'understand'
  ELSE 'chat_general'
END;
ALTER TABLE app.ai_usage_logs ADD CONSTRAINT ai_usage_logs_feature_check
  CHECK (feature IN ('chat_general','chat_with_records','extract','understand','embedding','eval'));
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON app.ai_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature ON app.ai_usage_logs(feature, created_at);

CREATE TABLE IF NOT EXISTS app.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(64) NOT NULL DEFAULT 'local',
  library_id VARCHAR(64) NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','done','archived')),
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  stages JSONB,
  source_type VARCHAR(16) NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('conversation','document','manual')),
  source_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_plans_status ON app.plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_library ON app.plans(library_id, status);
CREATE INDEX IF NOT EXISTS idx_plans_start ON app.plans(start_at);

-- ── 账号与登录态 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'temp'
    CHECK (role IN ('admin','temp')),
  library_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','deleted')),
  expires_at TIMESTAMPTZ,
  created_by VARCHAR(64),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS library_id VARCHAR(64);
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS created_by VARCHAR(64);
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_role_status ON app.users(role, status);
CREATE INDEX IF NOT EXISTS idx_users_expires ON app.users(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(64) NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON app.auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON app.auth_sessions(expires_at);

DROP TABLE IF EXISTS app.generator_files;
DROP TABLE IF EXISTS app.generator_sessions;
DROP TABLE IF EXISTS app.tool_calls;
DROP TABLE IF EXISTS app.agent_states;
