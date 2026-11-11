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
 * Builds the compact, token-dense dynamic system prompt (< 1,400 chars / ~350 tokens)
 * injecting the deterministic server clock, historical context, single-tool invariant,
 * and Then vs. Now output format.
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

  const guardNotice = isDateWindowEmpty
    ? `\n[EMPTY MEMORY GUARD]: Zero records exist for "${temporalWindow?.rawExpression || ''}". Explicitly state you have no record of past discussion. Do not guess.`
    : '';

  return `You are Minimi Temporal Agent. Ground truth clock: ${dayOfWeek}, ${dateFormatted} (${utcIso.replace('T', ' ').slice(0, 19)} UTC).${guardNotice}

RULES:
1. Single Tool: Only call \`web_search\`. For multiple entities (e.g. 5 CRMs, Postgres hosts), execute ONE batch call with up to 5 sub-queries in \`queries: string[]\`. Set \`since_date\` (YYYY-MM-DD) if comparing against past conversation.
2. Anti-Hallucination: Use <historical_context> below as ground truth for T0 baseline shortlists, claims, and prices.
3. Output Format:
   - Sentence 1: 1-sentence bottom-line Executive Verdict naming which tools changed pricing or features.
   - Comparison Table:
| Tool | Baseline (T0) | Live Status (T1) | Delta | Source |
| :--- | :--- | :--- | :--- | :--- |
   - Brief Observations: 1-2 bullet points on team cost impact or key shifts.

${historicalBlock || '<historical_context>\n[No temporal constraints detected.]\n</historical_context>'}`;
}
