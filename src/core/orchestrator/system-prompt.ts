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
1. Single Tool: You have access to strictly ONE tool: \`web_search\`. Execute it EXACTLY ONCE in Step 1 by batching all sub-queries into \`queries: string[]\`.
2. Do NOT call \`web_search\` again after getting results. Immediately output the final markdown table in the next step.
3. Anti-Hallucination: Use <historical_context> below as ground truth for T0 baseline shortlists, claims, and prices.
4. Output Format:
   - Sentence 1: 1-sentence bottom-line Executive Verdict naming which tools changed pricing or features.
   - Comparison Table:
| Tool | Baseline (T0) | Live Status (T1) | Delta | Source |
| :--- | :--- | :--- | :--- | :--- |
   - Brief Observations: 1-2 bullet points on team cost impact or key shifts.

${historicalBlock || '<historical_context>\n[No temporal constraints detected.]\n</historical_context>'}`;
}
