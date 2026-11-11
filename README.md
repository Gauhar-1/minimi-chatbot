# Minimi — Temporal Web-Search Chat Agent

> A production-grade **Temporal Web-Search Agent** built for the Minimi Hiring Challenge. Resolves relative calendar expressions deterministically, recalls episodic memory across past sessions via SQLite FTS5 + local embeddings using Reciprocal Rank Fusion ($k=60$), and executes live pricing verification through a strictly single-tool architecture.

For comprehensive architectural design principles, trade-off analyses, and scale-state considerations, see [**`DESIGN.md`**](DESIGN.md) and [**`AGENT.md`**](AGENT.md).

---

## 🚀 30-Second Quickstart (Zero-Friction Reviewer DX)

The application requires **zero Docker containers**, **zero external databases**, and **zero paid embedding API keys**.

### 1. Clone & Install
```bash
git clone <repo-url>
cd minimi-HiringChallenge
npm install
```

### 2. Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env
```

Open `.env` and add your API keys:
```env
# Choose provider: 'groq' (default, free), 'google', or 'openai'
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile

# Primary Free-Tier LLM Key (Free at https://console.groq.com/keys)
GROQ_API_KEY=gsk_your_groq_api_key_here

# Live Web Search (Free at https://tavily.com)
TAVILY_API_KEY=tvly_your_tavily_key_here
```

> **Note on Zero-Key Fallback:** If `TAVILY_API_KEY` is omitted, the built-in DuckDuckGo HTML fallback ensures web searches still function out-of-the-box.

### 3. Run Development Server
```bash
npm run dev
```
Open [**http://localhost:3000**](http://localhost:3000) in your browser.

On boot, `./data/agent.db` is **automatically seeded** with relative time-travel sessions anchored to your current clock.

---

## 🧪 Deterministic CLI Evaluation Harness

Run the automated evaluation suite verifying calendar math, 100% episodic entity recall, anti-hallucination guards, and the single-tool invariant:

```bash
npm run eval
```

### Expected Output:
```text
+----------+------------------------------------------+--------+---------+-----------------------------------------------------------+
| Suite ID | Test Suite Name                          | Status | Latency | Assertion Result                                          |
+----------+------------------------------------------+--------+---------+-----------------------------------------------------------+
| SUITE-1  | Monday CRM Shortlist (5 Tools) Recall    | ✔ PASS |   167ms | Window: 2026-11-09 | Recalled all 5 CRMs (HubSpot, Attio, |
| SUITE-2  | 3 November Technical Q&A Exact Recall    | ✔ PASS |   132ms | Window: 2026-11-03 | Recalled user question ($T0) & assis |
| SUITE-3  | Last Tuesday Postgres Hosting Recall     | ✔ PASS |     4ms | Window: 2026-11-10 | Recalled all 4 providers (Supabase,  |
| SUITE-4  | Empty Recall Guard & Single-Tool Invaria | ✔ PASS |     1ms | Status: EMPTY_FOR_DATE_WINDOW | Sole LLM Tool: [web_searc |
+----------+------------------------------------------+--------+---------+-----------------------------------------------------------+
🎉 ALL DETERMINISTIC VERIFICATION SUITES PASSED! (Exit code: 0)
```

---

## ⚡ Core Challenge Test Prompts

The UI features a **"One-Click Challenge Prompts"** bar in the header to run all Minimi challenge prompts with a single click:

| # | Prompt | Evaluated Subsystem |
| :--- | :--- | :--- |
| **1** | *"On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"* | Temporal grounding to past Monday, 100% recall of HubSpot, Attio, Pipedrive, Close, Salesforce at $T_0$, parallel search fan-out, and live $T_1$ pricing table delta. |
| **2** | *"What did I ask you on 3 November? Is your answer still correct today?"* | Exact calendar anchoring to Nov 3 ($T_0$), retrieval of user question and assistant answer on vector databases (Pinecone, Weaviate, Qdrant). |
| **3** | *"Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"* | Relative week arithmetic, recall of Supabase, Neon, AWS RDS, Render Postgres, and live verification. |
| **4** | *"What did I ask you on 19 August? Is your answer still correct?"* | **Empty Date Hallucination Guard:** Injects `recallStatus: EMPTY_FOR_DATE_WINDOW`. LLM explicitly tells user no conversation occurred on that date rather than guessing. |

---

## 🏛 Architectural Invariants

### 1. Strict Single-Tool Compliance
- The LLM tool registry (`tools` object passed to `streamText`) contains **strictly ONE tool**: `web_search`.
- URL scraping happens internally inside `web_search`; temporal memory recall happens in deterministic pre-inference middleware.

### 2. Hybrid Episodic Memory Engine & RRF
- Evaluates SQLite `messages_fts` (BM25 lexical ranking), in-process normalized 384-dim vector embeddings (`@xenova/transformers` with `all-MiniLM-L6-v2`), and temporal distance weighting.
- Combined via **Reciprocal Rank Fusion ($k = 60$)**:
  $$\text{RRF\_Score}(d) = \frac{w_{\text{time}}}{60 + r_{\text{time}}(d)} + \frac{w_{\text{bm25}}}{60 + r_{\text{bm25}}(d)} + \frac{w_{\text{vec}}}{60 + r_{\text{vec}}(d)}$$
- Formats `<historical_context>` capped at strictly 2,500 tokens.

### 3. Resilient Parallel Search & Deep Pricing Scraper
- Concurrent fan-out of up to 5 sub-queries via `Promise.allSettled`.
- Per-query `AbortController` (8,000ms timeout) with 1 retry on HTTP 429/503.
- Deep page scraping of top 3 vendor `/pricing` or `/changelog` URLs via `JSDOM` + `@mozilla/readability` + `turndown` with GFM table preservation.

### 4. Live Observability (X-Ray Trace Inspector)
- Click the **"X-Ray Trace"** button in the top right to open the slide-over drawer:
  - **Live Turn Telemetry:** Latency breakdown (`recall_ms`, `search_fanout_ms`, `scrape_ms`, `ttft_ms`, `total_ms`), executed queries, and scraped URLs.
  - **Recalled Memory:** Inspect the exact `<historical_context>` and atomic facts injected into the prompt.
  - **Seeded History Browser & 1-Click Reset:** View historical sessions and click **"Reset & Re-Seed"** at any time.

---

## 🛠 Available NPM Scripts

- `npm run dev` — Launch Next.js dev server on `http://localhost:3000`.
- `npm run eval` — Execute the deterministic CLI verification test suite.
- `npm run seed` — Re-seed relative time-travel sessions (`npm run seed -- --force`).
- `npm run typecheck` — Run TypeScript type checking (`tsc --noEmit`).
- `npm run build` — Compile Next.js production build.
- `npm run start` — Run production server.

