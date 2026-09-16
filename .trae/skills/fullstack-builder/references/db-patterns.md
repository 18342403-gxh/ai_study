# Database Patterns — Schema & Compatibility

PostgreSQL and SQLite schemas for common AI-app tables. Key gotchas when supporting both.

---

## ai_usage_logs — Cost Tracking

**SQLite** (INTEGER timestamps, bare table name):
```sql
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id TEXT PRIMARY KEY,
  feature TEXT NOT NULL CHECK(feature IN ('chat','rag','generator','embedding','eval')),
  model TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'zhipu',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_ms INTEGER NOT NULL DEFAULT 0,
  user_id TEXT,
  session_id TEXT,
  metadata TEXT,                    -- JSON stored as TEXT
  created_at INTEGER NOT NULL       -- ms timestamp
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON ai_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature ON ai_usage_logs(feature, created_at);
```

**PostgreSQL** (UUID, TIMESTAMPTZ, app schema):
```sql
CREATE SCHEMA IF NOT EXISTS app;
CREATE TABLE IF NOT EXISTS app.ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature VARCHAR(32) NOT NULL CHECK(feature IN ('chat','rag','generator','embedding','eval')),
  model VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'zhipu',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_ms INTEGER NOT NULL DEFAULT 0,
  user_id UUID,
  session_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON app.ai_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature ON app.ai_usage_logs(feature, created_at DESC);
```

---

## RAG Tables — documents + chunks

**SQLite**:
```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  type TEXT NOT NULL,           -- SQLite uses `type` for MIME
  status TEXT NOT NULL DEFAULT 'processing',
  chunk_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding TEXT,                -- JSON array as TEXT (cosine in app code)
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);
```

**PostgreSQL**:
```sql
CREATE TABLE IF NOT EXISTS app.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  size INTEGER NOT NULL,
  mime_type VARCHAR(128) NOT NULL,        -- PG uses `mime_type`, NOT NULL
  storage_path VARCHAR(500) NOT NULL,    -- PG has `storage_path`, NOT NULL
  status VARCHAR(32) NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing','ready','failed','deleted')),
  chunk_count INTEGER DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding vector(1536)                  -- requires pgvector extension
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON app.chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON app.chunks USING hnsw (embedding vector_cosine_ops);
```

---

## PG/SQLite Compatibility Rules — The Big Gotchas

| Item | SQLite | PostgreSQL | Fix |
|------|--------|------------|-----|
| **ID type** | TEXT (UUID string) | UUID | SQLite accepts UUID strings; PG needs UUID column type |
| **Timestamp** | INTEGER (ms) | TIMESTAMPTZ | DB facade converts: `> 1e12` number → `new Date(ms).toISOString()` |
| **Schema** | No schema | `app.` prefix | Facade injects: bare `table` → `app.table` in PG |
| **Placeholders** | `?` | `$1, $2, $3` | Facade rewrites `?` counting (skip `?` inside quotes) |
| **Type column** | Has `type` | Has `mime_type` + `storage_path` | **Don't use SELECT \***. INSERT with IS_PG conditional columns |
| **Vector store** | JSON TEXT + app-level cosine | pgvector extension | Same column name `embedding`, different types |
| **CREATE TABLE** | IF NOT EXISTS fine | Needs schema first + extension | Run `CREATE SCHEMA IF NOT EXISTS app` + `CREATE EXTENSION IF NOT EXISTS vector` |
| **SELECT \* behavior** | Returns all cols | Returns schema-qualified cols | Never SELECT * in shared code paths — always list exact columns |
| **CHECK constraint** | Loose (enforced at runtime) | Strict (enforced at INSERT) | Test INSERT with bad enum values against PG |

---

## Multi-Driver INSERT Pattern

```typescript
// WRONG — hardcoded columns only present in one driver
const WRONG = db.prepare('INSERT INTO documents (id, name, type) VALUES (?, ?, ?)')

// RIGHT — conditional columns
const IS_PG = getDriver() === 'postgres'
const cols = IS_PG
  ? 'id, name, mime_type, storage_path, status, chunk_count, created_at, updated_at'
  : 'id, name, type, status, chunk_count, created_at, updated_at'
const values = IS_PG
  ? '(?, ?, ?, ?, ?, ?, ?, ?)'
  : '(?, ?, ?, ?, ?, ?, ?)'
db.prepare(`INSERT INTO documents (${cols}) VALUES ${values}`).run(/* driver-specific params */)
```

---

## Date Aggregation — PG vs SQLite

```typescript
const driver = getDriver()
const dateExpr = driver === 'sqlite'
  ? `DATE(created_at / 1000, 'unixepoch')`     // INTEGER ms → days
  : `DATE(created_at)`                          // TIMESTAMPTZ → days

db.prepare(`SELECT ${dateExpr} as date, SUM(total_tokens) FROM ai_usage_logs GROUP BY ${dateExpr}`).all()
```
