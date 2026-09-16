---
name: fullstack-builder
description: Build full-stack AI-powered apps from zero to production. Use when starting a new project, choosing architecture, or when the user needs structured development phases. Do not use for single-feature bug fixes.
---

# Fullstack Builder

Complete a production-ready AI application through **6 mandatory phases**. Each phase has deliverables and a gate check — do not skip phases.

This skill does NOT force a tech stack. Every Phase 1 tech decision is a deliberate choice based on the project's scale, team, and constraints. The anti-patterns and gate checks apply regardless of stack.

---

## When to Use

**CRITICAL: Invoke this skill IMMEDIATELY when:**
- User says "let's build a new app", "start a project", or describes a product idea
- User asks for architecture recommendations or tech stack choices
- User wants step-by-step guidance through building a full application

**DO NOT use for:**
- Adding a single API endpoint or fixing a bug
- Code reviews on existing code
- Learning a specific framework in isolation

---

## Phase 1: Discovery & Design

**Goal**: Decide what to build and how to build it before writing any code.

### Actions

1. **Clarify the product** — Write a 2-paragraph Product Brief:
   - Who is the user? What pain are they solving?
   - What AI capability is the core differentiator? (chat? RAG? agent? code generation?)
   - What's out of scope for MVP?

2. **Profile the project** — Answer these, they drive every tech choice:
   - **Size**: personal side project? startup MVP? enterprise internal tool?
   - **Team**: solo dev? 2-3 people? 10+?
   - **Deployment**: local only? single VPS? Kubernetes? serverless?
   - **AI dependency**: one LLM call per hour? thousands per minute?
   - **Frontend scope**: single SPA? multi-page SSR? mobile? desktop?

3. **Choose tech stack** — For each layer, pick an option that fits the project profile. Write a 1-sentence justification linking the choice to a specific profile constraint (not "it's the latest").

   **Backend / BFF**
   | Profile | Pick |
   |---------|------|
   | Any Node.js app | Express 5, Fastify, or Hono |
   | Python-heavy team | FastAPI |
   | Go-heavy team | Gin, Fiber |
   | Edge/serverless | Hono, Cloudflare Workers |

   **Frontend**
   | Profile | Pick |
   |---------|------|
   | SSR + SEO needed | Nuxt (Vue) or Next.js (React) |
   | SPA / dashboard | Vite + Vue + Pinia, or Vite + React + Zustand |
   | Mobile-first | React Native + Expo, or Flutter (Dart) |
   | Desktop app | Tauri (Rust backend) or Electron (Node backend) |

   **Database**
   | Profile | Pick |
   |---------|------|
   | Small / local-first | SQLite (better-sqlite3 or sql.js) |
   | Standard web app | PostgreSQL |
   | NoSQL fit | MongoDB (only if data is genuinely document-shaped) |
   | Serverless | Supabase, PlanetScale, or DynamoDB |

   **Vector / Embedding store**
   | Profile | Pick |
   |---------|------|
   | < 100K docs, zero infra | SQLite + cosine similarity or DuckDB |
   | 100K — 10M | PostgreSQL + pgvector |
   | > 10M or hybrid search | Pinecone, Qdrant, Weaviate |
   | Multi-modal | Chroma or LanceDB |

   **Package management / layout**
   | Profile | Pick |
   |---------|------|
   | One app | Single package.json |
   | 2+ related apps | Monorepo (pnpm workspaces, npm workspaces, or Turborepo) |
   | Monorepo needed but simpler | Monorepo without shared packages |

4. **Draw the architecture** — 1 ASCII diagram. Label every service and the protocol between them (HTTP? WebSocket? queue?).

5. **List the data model** — Every table/collection with 5-8 key columns. Shapes only, no implementation.

### Gate Check (must pass before Phase 2)

- [ ] Product Brief written
- [ ] Project profile answered (size, team, deploy, AI scale, frontend scope)
- [ ] Every tech choice has a justification tied to the profile
- [ ] Architecture diagram drawn
- [ ] Data model listed

---

## Phase 2: Scaffolding

**Goal**: Create the project shell and infrastructure. No feature code yet.

### Actions

1. **Directory structure** — Match the choices from Phase 1:
   ```
   Monorepo example:              Single-app example:
   <project>/                     <project>/
   ├── apps/                      ├── src/
   │   ├── server/                │   ├── routes/
   │   └── web/                   │   ├── services/
   ├── packages/                  │   ├── db/
   │   └── shared/                │   └── index.ts
   ├── docs/                      ├── public/
   ├── package.json               ├── docs/
   └── .env.example               └── package.json
   ```

2. **Database layer** — Single-driver projects: wrap your ORM/driver in a thin service module. Multi-driver (SQLite + PG): implement a `getDb()` facade with unified async API (`prepare().run()`, `.get()`, `.all()`).

3. **BFF middleware pipeline** — Minimum set for any Node.js BFF:
   ```
   cors → body parser → request logger → error handler
   ```
   Add these based on profile:
   - Public-facing API → rate-limit
   - Expensive AI calls → circuit-breaker
   - Read-heavy endpoints → cache
   - Multi-tenant → auth middleware

4. **Logger** — Structured logger with levels. No `console.log` in production code. The logger should emit request IDs so you can trace one user's path through the system.

5. **Health check** — Single endpoint that reports dependency status:
   ```
   GET /health → { status: "ok", uptime, db: "ok|fail", llm: "ok|fail" }
   ```

### Gate Check (must pass before Phase 3)

- [ ] Dev server starts and serves the health endpoint
- [ ] DB tables auto-create on first run (or migrations run clean)
- [ ] Zero type errors in strict mode (TypeScript: `tsc --noEmit`, Python: `mypy`, Go: `go vet`)
- [ ] No `console.log` / `print` / `fmt.Println` in production source

---

## Phase 3: Core Features

**Goal**: Implement features one module at a time.

### Per-Module Procedure

For **each** feature module, follow this exact sequence:

1. **Design doc** — 10-20 lines: what does it do? What API endpoints? What data shapes?
2. **Route / handler** — Validate inputs, handle errors at module boundaries
3. **Service layer** — Business logic. **Inject cost tracking** if it calls an LLM or Embedding API.
4. **Frontend** — UI component that consumes the API. **Only build UI for what the backend exposes.**
5. **Manual test** — Hit the endpoint, verify response shape and error paths.
6. **Commit** — Descriptive message: `type(feature): description`

### Common AI Feature Patterns (adapt to your product)

| Pattern | Key Techniques |
|---------|---------------|
| Chat / Completion | Streaming (SSE or WebSocket), abort/cancel, token counting |
| RAG | Chunking → Embedding → Vector search → Prompt assembly → LLM answer |
| Agent | StateGraph or equivalent node graph, checkpoint/resume, tool calling |
| Code / Content Generation | Prompt builder chain, sandbox preview (iframe / web worker / Docker), iteration loop |
| Classification / Tagging | Single LLM call with structured output (JSON schema enforced) |

### Gate Check (per module)

- [ ] Feature works end-to-end (UI → API → response)
- [ ] Bad input → graceful error, not a crash
- [ ] LLM calls log usage to cost tracker
- [ ] Committed

---

## Phase 4: Cross-Cutting Concerns

**Goal**: Add production safety nets. These are **not optional** — ship with them or your app will break in production.

### 4a. Cost & Usage Tracking

Every LLM and Embedding call must be logged to a durable store:
```
feature (chat|rag|generator|…), model, prompt_tokens, completion_tokens, total_tokens, latency_ms, timestamp
```

- **Non-blocking**: Write asynchronously (EventEmitter, queue, fire-and-forget with try/catch). Never await usage logging in the hot path.
- **Budget alerts**: Configurable threshold. At 80% of daily budget → warn. At 100% → emit a structured event the frontend can subscribe to.
- **Query API**: At minimum, today's total, last 7 days by feature+model breakdown.

### 4b. Graceful Degradation

Every external dependency that can fail must have a fallback story:

| Dependency | Minimum Fallback |
|------------|-----------------|
| LLM API down | Retry with backoff, then show a clear "AI unavailable" state |
| Embedding API down | Deterministic fake vectors (hash-based: same text → same vector, different text → random directions). RAG works but precision drops. |
| Vector store down | Revert to keyword search or skip retrieval entirely |
| DB down | If you use SQLite as primary: no fallback needed (it's local). If you use a remote DB: have a local cache or read-only replica plan. |

### 4c. Input Safety

Before sending user input to an LLM, check for injection patterns:
- "ignore previous instructions", "you are now", "system prompt is"
- If detected: either reject or tag for human review

### Gate Check

- [ ] Disabling the LLM API key → app still boots (shows degraded state)
- [ ] Usage query endpoint returns real numbers after an LLM call
- [ ] Budget threshold documented in `.env.example`

---

## Phase 5: Productization

**Goal**: Make it feel like a real product, not a prototype.

### Actions

Pick only what your project needs:

1. **Empty states & loading** — Every list view has "nothing here yet" with a hint. Every async action shows a spinner.
2. **Error boundaries** — Frontend catches API failures, shows retry button. No white screens.
3. **Desktop wrapper** (only if you chose Electron/Tauri in Phase 1):
   - Wrapper spawns server + frontend as child processes
   - Wait for health check before creating the window
   - Graceful shutdown on app quit
4. **Build & deploy** — Match your deployment choice from Phase 1:
   - Single VPS: process manager (PM2, systemd) + reverse proxy (Caddy, Nginx)
   - Container: `docker-compose.yml` + `.env.production`
   - Serverless: config files for your platform (Vercel, Fly.io, etc.)
5. **Database migrations** — If you chose Postgres/MySQL: migration strategy (Drizzle, Prisma, or hand-written SQL files). If SQLite: skip — schema evolves with code.

### Gate Check

- [ ] App looks presentable on first launch (no blank screens)
- [ ] Invalid API key → app shows "please configure" instead of crashing
- [ ] Fresh clone + production config → app starts without hand-waving

---

## Phase 6: Documentation & Handoff

**Goal**: Leave a trail so you (or someone else) can maintain this app in 6 months.

### Actions

1. **Architecture walkthrough** — 1 doc explaining every major decision with trade-offs. "Why Express over Fastify?" "Why SQLite for vectors?"
2. **If this is a portfolio project**: 10 Q&A pairs about hard decisions you made.
3. **Cost summary** — "This app costs $X/month in API calls. Here are the top 3 things that cost money and how to reduce them."
4. **Troubleshooting guide** — Top 5 things that break, with fixes:
   - "Port already in use"
   - "Database connection refused"
   - "Embedding returns 429"

### Gate Check

- [ ] A new dev can clone, configure env, start the app, and see it working in under 10 minutes
- [ ] Every "why" decision has a written rationale

---

## Anti-Patterns (Do Not Do)

1. **Skip scaffolding** — Don't start with features. Bad scaffolding = painful refactors later.
2. **Force a monolith schema across drivers** — If you support both SQLite and Postgres, column names and types differ. Don't `SELECT *`.
3. **console.log / print in production code** — Use a structured logger everywhere.
4. **No error boundary** — An LLM 429 response should not white-screen the frontend.
5. **Hard-code secrets** — API keys, DB passwords always come from env vars or a secret manager.
6. **One giant prompt** — Break LLM interactions into: system prompt (stable) + context (RAG results) + user query.
7. **Embedding without fallback** — Embedding APIs go down, run out of credits, or throttle. Plan for it.
8. **No cost visibility** — If you can't answer "how much did that cost?", you can't control it.
9. **Over-engineering for the scale you don't have** — Don't set up a 5-node Kubernetes cluster for a personal project that serves 10 requests/day.
10. **Under-engineering for the scale you do have** — Don't run a SQLite file on a network share serving 10K users.

---

## Decision Reference

### Which LLM Provider?
| Need | Pick |
|------|------|
| Quick prototype, China | Zhipu AI (glm-4-flash) |
| US market | OpenAI (gpt-4o-mini for cheap, gpt-4o for quality) |
| Fully offline / private | Ollama + llama3 |
| Budget-conscious | DeepSeek (deepseek-chat) |
| Function calling focus | Any OpenAI-compatible API with tool support |

### Which Vector Store?
| Scale | Pick |
|-------|------|
| < 100K documents, zero infra | SQLite + cosine similarity, or DuckDB |
| 100K — 10M | PostgreSQL + pgvector |
| > 10M or hybrid search | Pinecone, Qdrant, Weaviate |
| Multi-modal | Chroma, LanceDB |

### Which Frontend?
| Need | Pick |
|------|------|
| SSR + SEO + full stack | Nuxt 3 (Vue) or Next.js (React) |
| SPA + dashboard feel | Vite + Vue + Pinia, or Vite + React + Zustand |
| Mobile-first | React Native + Expo, or Flutter |
| Desktop with web tech | Electron (Node) or Tauri (Rust, smaller binary) |

### Which DB?
| Need | Pick |
|------|------|
| Local-first, embedded | SQLite |
| Standard web app | PostgreSQL |
| Multi-region / globally distributed | CockroachDB, Supabase |
| Serverless | DynamoDB, PlanetScale, Upstash |
| Document-shaped data | MongoDB (only if data is genuinely document-shaped) |
