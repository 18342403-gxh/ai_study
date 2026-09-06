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
-- 1. documents
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
-- 4. messages
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
CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON app.messages(session_id, created_at);

-- ============================
-- 5. agent_states
-- ============================
CREATE TABLE IF NOT EXISTS app.agent_states (
  thread_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_json JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','completed','failed','cancelled')),
  current_node VARCHAR(64),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- 6. tool_calls
-- ============================
CREATE TABLE IF NOT EXISTS app.tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES app.sessions(id) ON DELETE SET NULL,
  tool_name VARCHAR(128) NOT NULL,
  args_json JSONB NOT NULL,
  result_json JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','success','error','timeout')),
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session_id ON app.tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_status ON app.tool_calls(status);

-- ============================
-- 7. generator_sessions
-- ============================
CREATE TABLE IF NOT EXISTS app.generator_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement TEXT NOT NULL,
  artifact_type VARCHAR(16) NOT NULL CHECK (artifact_type IN ('component','skill')),
  framework VARCHAR(16) CHECK (framework IS NULL OR framework IN ('vue','react')),
  skill_name VARCHAR(128),
  script_lang VARCHAR(8) CHECK (script_lang IS NULL OR script_lang IN ('ts','py')),
  state_json JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle','clarifying','retrieving','generating','previewing','completed','error')),
  iteration INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_gen_sessions_artifact_type ON app.generator_sessions(artifact_type);
CREATE INDEX IF NOT EXISTS idx_gen_sessions_status ON app.generator_sessions(status);

-- ============================
-- 8. generator_files
-- ============================
CREATE TABLE IF NOT EXISTS app.generator_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES app.generator_sessions(id) ON DELETE CASCADE,
  iteration INTEGER NOT NULL,
  file_path VARCHAR(512) NOT NULL,
  content TEXT NOT NULL,
  language VARCHAR(32),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gen_files_session_id ON app.generator_files(session_id);
CREATE INDEX IF NOT EXISTS idx_gen_files_session_iter
  ON app.generator_files(session_id, iteration);

-- ============================
-- 完成
-- ============================
SELECT '✅ All tables created in app schema' as result;
