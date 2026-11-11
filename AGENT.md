# AGENT.md — Architectural & Engineering Contract

## 1. Mission & Non-Negotiable Challenge Invariants
You are building a production-grade **Temporal Web-Search Chat Agent** for the Minimi Hiring Challenge. Every line of code must obey four strict invariants:

1. **Strict Single-Tool Rule:** The LLM tool registry (`tools` object passed to `streamText`) MUST contain **strictly ONE tool**: `web_search`. Never register a second tool (no `memory_search` tool, no `calculator` tool, no `scrape_url` tool). Temporal memory recall happens deterministically in pre-inference middleware; URL scraping happens internally inside `web_search`.
2. **Zero-Friction Startup (`npm install && npm run dev`):** The app must boot and work immediately on a fresh clone with zero Docker containers, zero cloud DB setup, and zero paid embedding keys.
3. **100% Free-Tier Compatible Stack:**
   - **LLM Provider:** Configurable via `.env` (`GROQ_API_KEY` using `llama-3.3-70b-versatile`).
   - **Search Provider:** Tavily API (`TAVILY_API_KEY`) with automatic fallback to DuckDuckGo HTML / Jina search if rate-limited or missing.
   - **Embeddings:** 100% local in-process embeddings via `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384 dimensions). Zero API key required.
   - **Database:** Local embedded `better-sqlite3` (`./data/agent.db`) with WAL mode, `FTS5` virtual tables, and `Float32Array` vector buffers.
4. **Auto-Seeded Time-Travel Fixtures:** On first boot, if `./data/agent.db` is empty, automatically seed historical sessions anchored relative to the host's current clock (`Monday` = 5 CRM tools for a 20-person sales team; `Last Tuesday` = Postgres hosting comparison; `3 November` = historical technical Q&A) so evaluator prompts work out-of-the-box.

---

## 2. Tech Stack & Pinned Versions (Anti-Hallucination Guardrails)
- **Runtime & Framework:** Node.js >= 20, Next.js 14/15 (App Router), TypeScript 5.x (`strict: true`).
- **AI Orchestration:** Vercel AI SDK v4 (`ai`, `@ai-sdk/groq`, `@ai-sdk/google`, `@ai-sdk/openai`, `zod`).
  - **CRITICAL SDK RULE:** Use Vercel AI SDK v4 primitives ONLY (`streamText`, `tool`, `createDataStreamResponse`, `useChat` from `@ai-sdk/react`). **NEVER** use deprecated v2/v3 APIs (`OpenAIStream`, `StreamingTextResponse`, `experimental_StreamData`).
- **Database & NLP:** `better-sqlite3`, `chrono-node` (deterministic date parsing), `@xenova/transformers` (local embeddings), `jsdom` + `@mozilla/readability` + `turndown` (HTML-to-Markdown table scraping).
- **UI & Styling:** Tailwind CSS, `lucide-react`, `react-markdown`, `remark-gfm` (for rendering `Then vs. Now` pricing comparison tables).
- **Next.js Bundler Config (`next.config.mjs`):**
  You MUST configure `serverExternalPackages: ['better-sqlite3', '@xenova/transformers', 'jsdom']` so Webpack/Turbopack never bundles native C++ addons or ONNX binaries. Every API route using SQLite must declare `export const runtime = 'nodejs';`.

---

## 3. SOLID Principles & Clean Architecture (Scale-Ready Design)
We are building the **Product State** today while keeping the codebase ready to swap into the **Scale State** (Postgres/Qdrant, Redis cache, multi-provider search router, BullMQ workers) tomorrow without modifying core business logic.

1. **Single Responsibility Principle (SRP):**
   - `TemporalParser` ONLY resolves natural language dates into UTC windows `[startUtc, endUtc]`.
   - `HybridMemoryEngine` ONLY executes SQLite FTS5 + Vector cosine similarity + Reciprocal Rank Fusion (RRF).
   - `WebSearchTool` ONLY executes parallel search fan-out, deduplication, and Readability DOM scraping.
   - `FactCompactor` ONLY extracts atomic post-turn facts asynchronously.
2. **Open/Closed Principle (OCP):**
   - Search providers and LLM models are resolved via factory functions (`createSearchProvider()`, `resolveLanguageModel()`). Adding Exa or Brave Search requires adding a new class implementing `ISearchProvider`, never modifying the orchestrator.
3. **Liskov Substitution Principle (LSP):**
   - Any implementation of `ISearchProvider` (Tavily, Serper, MockEvalSearchProvider) must return the exact `SearchExecutionResult` contract and honor the passed `AbortSignal` without throwing unhandled rejections.
4. **Interface Segregation Principle (ISP):**
   - Split storage contracts into focused interfaces: `IMemoryReader` (used by pre-inference middleware), `IMemoryWriter` (used by post-turn compaction), and `ITraceLogger` (used by observability).
5. **Dependency Inversion Principle (DIP):**
   - High-level orchestration (`ChatOrchestrator`) depends strictly on TypeScript interfaces in `src/core/contracts/`, never on concrete `better-sqlite3` or `fetch` calls directly.

---

## 4. Target Directory Structure
```text
├── DESIGN.md                        # Architectural one-pager (Do not delete)
├── AGENT.md                         # This engineering contract
├── .env.example                     # Documented environment variables
├── next.config.mjs                  # serverExternalPackages config
├── package.json
├── tsconfig.json
├── data/                            # Git-ignored SQLite DB & local ONNX cache
├── scripts/
│   ├── seed.ts                      # Deterministic relative-date fixture seeder
│   └── eval.ts                      # Deterministic CLI evaluation harness (npm run eval)
└── src/
    ├── core/
    │   ├── contracts/               # SOLID Interfaces & Zod schemas
    │   │   ├── memory.contract.ts   # IMemoryReader, IMemoryWriter, RecalledContext
    │   │   ├── search.contract.ts   # ISearchProvider, WebSearchInputSchema
    │   │   └── trace.contract.ts    # ITraceLogger, TurnTracePayload
    │   ├── temporal/
    │   │   └── chrono-parser.ts     # chrono-node UTC window & relative date resolver
    │   ├── memory/
    │   │   ├── sqlite-client.ts     # HMR-safe globalThis SQLite singleton + schema init
    │   │   ├── local-embedder.ts    # HMR-safe @xenova/transformers singleton
    │   │   ├── hybrid-retriever.ts  # FTS5 BM25 + Vector Cosine + RRF (k=60)
    │   │   ├── fact-compactor.ts    # Async post-turn atomic fact extractor
    │   │   └── auto-seeder.ts       # Seeds Monday (5 CRMs), Last Tuesday (Postgres), Nov 3
    │   ├── search/
    │   │   ├── tavily.provider.ts   # Parallel fan-out via Promise.allSettled + AbortController
    │   │   ├── markdown-scraper.ts  # Readability + Turndown pricing table extractor
    │   │   └── web-search.tool.ts   # The SINGLE Vercel AI SDK tool definition
    │   └── orchestrator/
    │       ├── system-prompt.ts     # Dynamic prompt builder with <historical_context>
    │       └── chat-orchestrator.ts # 4-stage pipeline coordinator + trace recording
    ├── app/
    │   ├── api/
    │   │   ├── chat/route.ts        # POST streaming endpoint (createDataStreamResponse)
    │   │   └── traces/route.ts      # GET endpoint for X-Ray Trace Drawer & seeded sessions
    │   ├── layout.tsx
    │   └── page.tsx                 # Main Chat UI + X-Ray Trace Inspector + Seed Switcher
    └── components/
        ├── chat-viewport.tsx        # Virtualized/memoized message list with auto-scroll lock
        ├── pipeline-stepper.tsx     # Live SSE phase pills (Recalling -> Searching -> Scraping)
        ├── markdown-renderer.tsx    # GFM tables, citation badges, Then-vs-Now diff cards
        └── xray-trace-drawer.tsx    # Collapsible observability inspector showing ms breakdown

```

---

## 5. Core Subsystem Specifications (Implementation Blueprint)

### 5.1 Stage 1: Deterministic Temporal Parser (`src/core/temporal/chrono-parser.ts`)

* Anchor `chrono.parse(prompt, referenceDate, { forwardDate: false })` to the current server clock.
* Edge case rule: If today is Monday and the user says *"On Monday"*, resolve to **7 days ago** (00:00:00.000 UTC to 23:59:59.999 UTC), never today's incomplete day.
* Edge case rule: If the user says *"3 November"*, resolve to November 3 of the most recent past occurrence (`00:00:00 UTC` to `23:59:59 UTC`) and compute `sinceDateIso = "YYYY-11-03"`.
* Return `{ hasTemporalReference: boolean, rawExpression?: string, startUtc?: string, endUtc?: string, sinceDateIso?: string, searchKeywords: string[] }`.

### 5.2 Stage 2: Hybrid Episodic Memory & RRF (`src/core/memory/hybrid-retriever.ts`)

* **SQLite Tables:**
* `messages (id, session_id, role, content, created_at_utc, embedding BLOB)`
* `messages_fts USING fts5(content, message_id UNINDEXED, created_at_utc UNINDEXED)`
* `session_facts (id, session_id, fact_text, entities_json, reference_date_utc, embedding BLOB)`
* `turn_traces (id, session_id, user_prompt, trace_json, created_at_utc)`


* **Reciprocal Rank Fusion ($k = 60$):**

$$\text{RRF\_Score}(d) = \frac{w_{\text{time}}}{60 + r_{\text{time}}(d)} + \frac{w_{\text{bm25}}}{60 + r_{\text{bm25}}(d)} + \frac{w_{\text{vec}}}{60 + r_{\text{vec}}(d)}$$


* When `hasTemporalReference === true`, boost items inside `[startUtc, endUtc]` with $w_{\text{time}} = 2.5$.
* **Empty Recall Guard:** If `hasTemporalReference === true` and zero records exist within $\pm 24\text{h}$ of `[startUtc, endUtc]`, return `recallStatus: 'EMPTY_FOR_DATE_WINDOW'`. The system prompt MUST instruct the LLM to explicitly tell the user no conversation occurred on that date rather than guessing.
* **Context Cap:** Truncate formatted `<historical_context>` to strictly $\le 2,500$ tokens, always including both the user's historical question ($T_0$) and the assistant's historical answer/shortlist ($T_0$).



### 5.3 Stage 3: The Single `web_search` Tool (`src/core/search/web-search.tool.ts`)

* **Zod Input Schema:**
```ts
export const WebSearchInputSchema = z.object({
  queries: z.array(z.string().min(3)).min(1).max(5).describe(
    "1 to 5 specific search queries to execute in parallel. When checking multiple tools/companies from historical context, pass one targeted query per entity in a single batch call."
  ),
  since_date: z.string().optional().describe(
    "Optional ISO date (YYYY-MM-DD) from the historical conversation to focus on pricing changes, changelogs, or releases since that date."
  ),
  deep_scrape_top_urls: z.boolean().default(true).describe(
    "Set to true when verifying SaaS pricing tiers, changelogs, or technical specs so top URLs are scraped into clean Markdown tables."
  )
});

```


* **Resilience & Loop Guards:**
* Execute all `queries` concurrently via `Promise.allSettled`.
* Wrap each HTTP search call in an `AbortController` with an **8,000ms timeout** and 1 retry with jittered backoff (400ms) on HTTP `429` or `503`.
* Maintain a per-turn `Set<string>` of normalized URLs across all tool steps (`maxSteps: 4`) so the agent never scrapes or returns the same URL twice.
* When `deep_scrape_top_urls` is `true`, pick up to the top 3 highest-scoring official `/pricing` or `/changelog` URLs across the batch, fetch HTML with a **3,500ms timeout**, parse via `@mozilla/readability` + `turndown` (keeping HTML `<table>` conversion enabled), and hard-cap each scraped page at **1,200 tokens** (4,800 characters). If a page returns `403`/Cloudflare challenge, fall back gracefully to the search snippet without failing the tool call.



---

## 6. UI/UX & Rendering Principles ("Fast & Good to Talk To")

1. **Zero Perceived Latency via Custom Stream Data:**
* Use Vercel AI SDK's `createDataStreamResponse` (`dataStream.writeData(...)`) to push real-time pipeline events *before* LLM tokens arrive:
* `{ type: 'phase', phase: 'temporal_parse', detail: 'Resolved "Monday" -> 2026-11-09' }`
* `{ type: 'phase', phase: 'memory_recall', detail: 'Recalled 5 shortlisted CRMs from Nov 9 (4.2ms)' }`
* `{ type: 'phase', phase: 'search_fanout', detail: 'Searching HubSpot, Attio, Pipedrive, Close, Salesforce in parallel...' }`
* `{ type: 'phase', phase: 'deep_scrape', detail: 'Extracting live Markdown pricing tables (3 URLs)...' }`
* `{ type: 'trace_complete', trace: TurnTracePayload }`




2. **Structured "Then ($T_0$) vs. Now ($T_1$)" Presentation:**
* Instruct the LLM in `system-prompt.ts` to format temporal verification answers with a scannable **Summary Verdict** in sentence 1, followed by a clean Markdown comparison table (`Tool | Historical Baseline (T0) | Current Live Status (T1) | Delta / Shipped Changes | Source`).


3. **Interactive Evaluator Features in UI Header:**
* **"X-Ray Trace" Toggle Button:** Opens the right-hand drawer displaying the exact latency breakdown (`recall_ms`, `search_fanout_ms`, `scrape_ms`, `ttft_ms`), RRF-matched historical facts, and executed parallel search queries.
* **"One-Click Challenge Prompts" Bar:** Render tappable chips for Minimi's 3 exact test prompts so the evaluator can test them with one click immediately after `npm run dev`.



---

## 7. Code Quality & Error-Handling Standards

* **No `any` or Silent `catch {}`:** Enable `"strict": true` and `"noImplicitAny": true`. Every `catch (err)` must normalize the error into a typed `Result<T, AppError>` or structured warning object so partial failures never crash the SSE stream.
* **HMR Singleton Pattern:** Wrap both `better-sqlite3` and the `@xenova/transformers` pipeline in `globalThis.__agentSqlite` / `globalThis.__agentEmbedder` so Next.js dev server reloads never leak file descriptors or memory.
* **Environment Validation:** On server boot, validate `.env` with Zod. If `TAVILY_API_KEY` or an LLM key is missing, print a clear, actionable terminal box explaining exactly which free-tier key to add to `.env`.

---

## 8. Mandatory Step-by-Step Build Order (Follow Sequentially)

Do NOT generate UI components before the core domain contracts and database layer compile. Execute in this exact sequence:

1. **Phase 1 (Config & Contracts):** `package.json`, `tsconfig.json`, `next.config.mjs`, `.env.example`, and `src/core/contracts/*.ts`.
2. **Phase 2 (Temporal & Hybrid Memory):** `chrono-parser.ts`, `sqlite-client.ts`, `local-embedder.ts`, `hybrid-retriever.ts`, and `auto-seeder.ts`.
3. **Phase 3 (Resilient Search Tool):** `markdown-scraper.ts`, `tavily.provider.ts`, and `web-search.tool.ts`.
4. **Phase 4 (Orchestrator & API Routes):** `system-prompt.ts`, `fact-compactor.ts`, `chat-orchestrator.ts`, `/api/chat/route.ts`, and `/api/traces/route.ts`.
5. **Phase 5 (Frontend & X-Ray Inspector):** `pipeline-stepper.tsx`, `markdown-renderer.tsx`, `xray-trace-drawer.tsx`, and `app/page.tsx`.
6. **Phase 6 (Verification):** `scripts/eval.ts` (`npm run eval`) testing all 3 Minimi challenge prompts against the seeded database.

```

