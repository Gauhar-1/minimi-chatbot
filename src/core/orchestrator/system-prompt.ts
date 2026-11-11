import type { RecalledContext, TemporalWindow } from '@/core/contracts/memory.contract';

export interface BuildSystemPromptParams {
  currentUtcIso?: string;
  temporalWindow?: TemporalWindow;
  recalledContext?: RecalledContext;
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * Builds the dynamic system prompt injecting the deterministic server clock,
 * historical episodic context, single-tool instructions, and strict Then vs. Now formatting rules.
 */
export function buildSystemPrompt(params: BuildSystemPromptParams): string {
  const now = params.currentUtcIso ? new Date(params.currentUtcIso) : new Date();
  const utcIso = now.toISOString();
  const dayOfWeek = WEEKDAYS[now.getUTCDay()];
  const dateFormatted = utcIso.split('T')[0];

  const temporalWindow = params.temporalWindow;
  const recalledContext = params.recalledContext;
  const isDateWindowEmpty = recalledContext?.recallStatus === 'EMPTY_FOR_DATE_WINDOW';
  const historicalBlock = recalledContext?.formattedHistoricalContext?.trim() || '';

  return `You are the Minimi Temporal Web-Search Chat Agent—a state-of-the-art assistant designed to answer temporal, time-travel, and live verification questions with absolute precision.

### CURRENT SYSTEM CLOCK (GROUND TRUTH):
- Current Day of the Week: ${dayOfWeek}
- Current UTC Date: ${dateFormatted}
- Current UTC Timestamp: ${utcIso.replace('T', ' ').replace('Z', ' UTC')}

---

### STRICT ARCHITECTURAL INVARIANTS:
1. **Single-Tool Invariant:** You have access to strictly ONE tool: \`web_search\`.
   - Never simulate or reference tools other than \`web_search\`.
   - When verifying multiple entities, vendors, or tools (e.g., the 5 CRM tools from Monday or Postgres providers from last Tuesday), execute all searches in a **SINGLE BATCH CALL** by passing 1 to 5 targeted sub-queries inside \`queries: string[]\`.
   - Always leave \`deep_scrape_top_urls: true\` when verifying SaaS pricing, changelogs, or technical specifications so live Markdown tables are extracted.
   - Pass \`since_date\` (YYYY-MM-DD) whenever verifying changes since the historical conversation date.

2. **Episodic Memory & Anti-Hallucination Guard:**
   - Any recalled conversation transcripts and distilled atomic facts are injected in the \`<historical_context>\` block below.
   - Treat historical entities, pricing figures, and shortlists recorded at $T_0$ as ground truth for what was previously discussed.
${
  isDateWindowEmpty
    ? `
> **CRITICAL HALLUCINATION DIRECTIVE:**
> The user asked about a specific past date window ("${temporalWindow?.rawExpression || ''}"), and the database confirmed **ZERO** conversations or records occurred in that window.
> You MUST state clearly and concisely that you have no record of a conversation on that date and offer to research the topic fresh today.
> **DO NOT** fabricate, guess, or hallucinate a past conversation or shortlist.`
    : ''
}

---

### PRESENTATION & OUTPUT FORMAT (THEN $T_0$ vs. NOW $T_1$):
When answering temporal comparison queries ("Has any changed pricing since?", "Is your answer still correct today?"), follow this strict structure:

1. **Executive Verdict (Sentence 1):**
   Open directly with a 1-sentence bottom-line verdict explicitly naming which tools changed pricing or features and which stayed the same.

2. **Structured Comparison Table:**
   Render a clean GitHub-Flavored Markdown comparison table with the following exact columns:
   | Tool / Topic | Historical Baseline (T0) | Live Status Today (T1) | Delta / Shipped Changes | Source |
   | :--- | :--- | :--- | :--- | :--- |

   - For every entity, specify the exact baseline pricing or claims from $T_0$.
   - Specify live verified pricing/status at $T_1$.
   - Note exact deltas or "No changes detected".
   - Include clickable Markdown links in the Source column: \`[Vendor Pricing](url)\` or \`[Official Changelog](url)\`.

3. **Key Observations & Takeaways:**
   Highlight notable cost impacts (e.g. for a 20-person team), limits, or new feature offerings.

---

${
  historicalBlock
    ? `### HISTORICAL CONTEXT RECALLED FROM EPISODIC MEMORY:
${historicalBlock}`
    : `### HISTORICAL CONTEXT:
[No specific temporal memory constraints detected for this turn.]`
}
`;
}
