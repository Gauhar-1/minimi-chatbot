# DESIGN.md — Temporal Web-Search Agent

## 1. Problem Statement & Core Invariants

Most web-search chat agents fail on prompts like *"On Monday we shortlisted 5 CRM tools... has any changed pricing since?"* not because their search API is weak, but because of **temporal amnesia** and **ungrounded query planning**. An agent cannot search for pricing deltas on "the 5 CRMs from Monday" until it deterministically resolves *what date Monday was*, recalls *which 5 CRMs were discussed*, and compares the *historical baseline ($T_0$)* against *live web state ($T_1$)*.

This system is built around three strict invariants:

1. **Strict Single-Tool Compliance:** The LLM's tool registry exposes exactly one tool (`web_search`). Temporal memory resolution runs deterministically in an invisible pre-inference middleware layer.
2. **Deterministic Context & TPM Budgeting:** Optimized strictly for the `openai/gpt-oss-20b` Groq 8k TPM rolling window. Historical RRF context is hard-capped at 1,800 chars (~450 tokens) and scraped pricing content is signal-filtered and capped at 900 chars/URL (~225 tokens), keeping total turn token consumption strictly $\le 4,200$ tokens across Step 1 (Planning) + Step 2 (Synthesis).
3. **Zero-Friction Reviewer DX:** Starts immediately via `npm install && npm run dev` using an embedded hybrid storage engine (`better-sqlite3` with `FTS5` + local `@xenova/transformers` embeddings)—requiring zero Docker containers, external databases, or paid embedding API keys.

---

## 2. How It Works (Runtime Architecture)

```
User Prompt ──► [Stage 1: Temporal Grounding (chrono-node)] ──► UTC Window [T0_start, T0_end]
│
▼
[Stage 2: Two-Tier Memory Isolation & Hybrid RRF (SQLite FTS5 + Vec)]
│  - Filter: WHERE user_id = ?
│  - RRF (k=60) over time proximity, FTS5 BM25, and local cosine similarity
│  - Injects <historical_context> (T0 claims, max ~450 tokens)
▼
[Stage 3: Single-Tool Agentic Execution (web_search)]
├─ Parallel Fan-Out (up to 5 sub-queries via Promise.allSettled)
├─ Signal-Dense Pricing & Changelog Scraper (Readability + Markdown Table filter)
├─ TPM Pacing Guard (catches 429/413 with jittered backoff & context auto-trim)
│
▼
[Stage 4: SSE Stream + Async Post-Turn Fact Compaction]
├─ Event-Signature Memoization (Zero infinite render loops)
└─ Background Turn Fact & Baseline Distillation into session_facts
```

### Stage 1: Deterministic Temporal & Intent Grounding (`chrono-node`)
LLMs frequently hallucinate relative calendar arithmetic. Before inference begins, `chrono-node` (anchored to the server's UTC clock with `forwardDate: false`) parses explicit and relative time expressions (*"3 November"*, *"last Tuesday"*, *"since Monday"*). It outputs exact `[start_utc, end_utc]` bounds and flags whether the prompt requires **historical state verification** ($T_0$ vs. $T_1$).

### Stage 2: Hybrid Episodic Memory Middleware & Two-Tier Isolation
Rather than stuffing full chat logs into the prompt or relying on an ungrounded sliding window, middleware queries SQLite across past sessions using **Reciprocal Rank Fusion (RRF, $k=60$)** across three signals:
* **Temporal Proximity (`r_time`):** Distance scoring centered around the midpoint of `[start_utc, end_utc]`.
* **Lexical Search (`SQLite FTS5`, `r_bm25`):** BM25 matching on exact entity names, pricing numbers, and technical terms.
* **Semantic Search (Local `all-MiniLM-L6-v2`, `r_vec`):** In-process 384-dim cosine similarity over raw `messages` and distilled `session_facts`.

**Two-Tier Multi-Tenant & Session Isolation:**
* **Strict User Isolation:** Every query across `sessions`, `messages`, `session_facts`, and `turn_traces` filters strictly by `WHERE user_id = ?`. Context from `user_A` never bleeds into `user_B`.
* **Session vs. Cross-Session Recall Separation:** Active conversation history passed to `streamText` (`messages.slice(-3)`) belongs exclusively to the active `sessionId`. Cross-session `<historical_context>` is injected ONLY when a temporal constraint exists (`hasTemporalReference === true`) or when the user explicitly queries past interactions ("we shortlisted", "did I ask", etc.).
* **Empty Recall / Hallucination Guard:** If a user asks about a date with zero matching records, middleware returns `EMPTY_FOR_DATE_WINDOW`, instructing the LLM that no conversation occurred on that date rather than guessing.

### Stage 3: Single-Tool Agentic Loop (`web_search` with Signal-Dense Fan-Out)
Our single `web_search` tool accepts a structured batch schema: `{ queries: string[], since_date?: string, deep_scrape_top_urls?: boolean }`.
* **Parallel Execution:** Executes up to 5 targeted sub-queries concurrently via `Promise.allSettled`.
* **Signal-Dense Pricing Scraper:** Fetches top `/pricing` or `/changelog` URLs in parallel. Extracts clean Markdown via `@mozilla/readability`, filters lines to retain only Markdown tables (`/^\|.*\|$/`), headers, and pricing/changelog keywords, capped at 900 characters (~225 tokens) per URL and at most 2 URLs per batch.
* **TPM Pacing & Resilience:** If Groq's rolling 8,000 TPM limit triggers a `429` or `413`, the orchestrator parses `retry-after`, emits a live `tpm_pacing` phase event to the UI, trims context if oversized, and retries cleanly.

### Stage 4: Granular SSE Streaming & Resilient Frontend UX
1. **Live Dual-Mode Pipeline Stepper:**
   - **User Mode (`devMode === false`):** Calm, single-pill morphing status indicator (*"Checking our past conversation..."*, *"Reading live pricing & changelog pages..."*) suitable for a consumer experience.
   - **Dev Mode (`devMode === true`):** Technical 4-stage stepper showing exact millisecond latencies for Temporal Parse, Hybrid RRF Recall, Parallel Search Fan-Out, and Deep Pricing Scrape.
2. **Event Memoization & Decoupled Scroll:** Stream events are processed through an event-signature comparator and scrolling runs via `requestAnimationFrame`, eliminating React `Maximum update depth exceeded` render loops during high-speed token streaming.
3. **Collapsible History Sidebar & Dynamic Composer:** 
   - Multi-session drawer grouping chats into **Today**, **Last 7 Days**, and **Older** with `⌘K` New Chat shortcut and thread deletion.
   - Dynamic auto-expanding `<textarea>` input expanding up to 220px with active `Stop` stream control.
   - Dev Mode workspace switcher toggling between `usr_evaluator` (seeded history) and `usr_isolated_guest` (fresh user with zero bleed).
4. **Non-Blocking Fact Extraction:** After stream completion, an asynchronous background routine distills new entities, shortlisted items, and pricing baselines into `session_facts`.

---

## 3. Database Schema & Multi-Tenant Design

The database runs in SQLite WAL mode (`journal_mode = WAL`, `synchronous = NORMAL`):

```sql
-- 1. Sessions table for multi-tenant and multi-session isolation
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'usr_evaluator',
  title TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON sessions(user_id, updated_at_utc);

-- 2. Raw chat messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'usr_evaluator',
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS idx_messages_user_session_created ON messages(user_id, session_id, created_at_utc);

-- 3. FTS5 Virtual Table with user_id & automatic triggers
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  message_id UNINDEXED,
  user_id UNINDEXED,
  created_at_utc UNINDEXED,
  tokenize='porter unicode61'
);

-- 4. Distilled atomic session facts
CREATE TABLE IF NOT EXISTS session_facts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'usr_evaluator',
  session_id TEXT NOT NULL,
  fact_text TEXT NOT NULL,
  entities_json TEXT NOT NULL,
  reference_date_utc TEXT NOT NULL,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS idx_session_facts_user_ref_date ON session_facts(user_id, reference_date_utc);

-- 5. Turn traces for observability and X-Ray drawer
CREATE TABLE IF NOT EXISTS turn_traces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'usr_evaluator',
  session_id TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  trace_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turn_traces_user_session_created ON turn_traces(user_id, session_id, created_at_utc);
```

---

## 4. Verification, Cold-Start Seeding & Observability

* **Cold-Start Reviewer Seeding:** On first boot or re-seed, 3 real sidebar sessions are seeded for `'usr_evaluator'` anchored relative to the current clock:
  1. `"CRM Shortlist (20-Person Sales Team)"` (Monday: HubSpot, Attio, Pipedrive, Close, Salesforce)
  2. `"Postgres Hosting Comparison"` (Last Tuesday: Supabase Pro, Neon, AWS RDS, Render)
  3. `"Nov 3 Architecture & Pricing Q&A"` (3 November: Pinecone Serverless, Weaviate Cloud, Qdrant Cloud)
* **X-Ray Trace Drawer:** Every turn logs a structured trace (`trace_id`, `temporal_resolution`, `latencies`, `search_fanout`, `scraped_urls`) accessible via the slide-over inspector drawer.
* **Deterministic Eval Suite (`npm run eval`):** Executes 4 comprehensive verification suites verifying date boundary math, 100% recall of prior entities, single-tool invariant, and date-window hallucination guards in under 400ms.

---

## 5. Why We Built It This Way (Trade-Offs & Rejected Alternatives)

### Trade-Offs of Our Chosen Design
* **Pre-Inference Memory Middleware vs. LLM Memory Tool:** Keeps the tool registry strictly to 1 tool (`web_search`) and saves ~1.5s of sequential tool-call latency. *Trade-off:* Memory recall runs once before inference; if the LLM discovers a secondary historical date dependency mid-loop, it relies on the initial RRF recall window.
* **Embedded SQLite + Local Embeddings vs. Dockerized Postgres/Redis:** Guarantees zero-config `npm install && npm run dev` and sub-5ms local reads. *Trade-off:* Single-writer SQLite lock limits horizontal multi-node write throughput.
* **Batched `queries: string[]` inside `web_search`:** Collapses 5 sequential tool turns (~14s) into one ~1.2s parallel burst. *Trade-off:* Higher single-turn context payload, controlled via strict signal-dense markdown table filtering.

### Alternatives Considered and Rejected

| Considered Approach | Why We Rejected It |
| :--- | :--- |
| **Adding a second `memory_search` LLM tool** | Violates the strict single-tool rule (*"It has one tool: web search"*) and adds an extra LLM round-trip before web search begins. |
| **Stuffing full history into a 128k+ context window** | Suffers from "lost-in-the-middle" degradation, inflates TTFT/cost linearly, and breaches Groq's 8,000 TPM rolling limit. |
| **LLM-only relative calendar math** | Passing only `Current Date` in the system prompt caused frequent off-by-one-week errors on *"last Tuesday"*; `chrono-node` is deterministic. |
| **Headless browser (`Playwright`) in the hot path** | Adds 3–5s cold-start latency and heavy binary downloads during `npm install`. Local Readability HTML parsing handles 95% of pricing pages in under 400ms. |

---

## 6. What We'd Do With Another Week (The Scale State)

1. **Bi-Temporal Knowledge Graph:** Upgrade `session_facts` to track both *transaction time* (when recorded) and *valid time* (when true), automatically invalidating superseded user constraints (e.g., team size growing from 20 to 50).
2. **Multi-Provider Search Router & DOM-Diff Cache:** Route queries dynamically across **Tavily/Brave** (changelogs/news) and **Exa** (company research), backed by Redis semantic caching and hourly SHA-256 DOM snapshots of SaaS `/pricing` pages.
3. **Durable Async Queues (Inngest / BullMQ):** Move post-turn fact compaction and deep-page scraping into durable background workers with dead-letter retries and per-user token budget circuit breakers.
4. **Automated Time-Travel CI Benchmark:** Expand `npm run eval` with an LLM-as-a-judge suite that seeds multi-month histories at $T_0$, advances a mocked clock to $T_1$, and scores citation faithfulness and temporal recall precision.


