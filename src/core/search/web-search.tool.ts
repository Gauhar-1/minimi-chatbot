import { tool } from 'ai';
import {
  WebSearchInputSchema,
  type WebSearchInput,
  type SearchExecutionResult,
  type ISearchProvider,
} from '@/core/contracts/search.contract';
import { createSearchProvider } from './tavily.provider';
import type { PipelinePhaseEvent } from '@/core/contracts/trace.contract';

export interface WebSearchToolDependencies {
  searchProvider: ISearchProvider;
  seenUrls: Set<string>;
  onPhaseEvent?: (e: PipelinePhaseEvent) => void;
  onSearchMetric?: (metric: {
    fanoutMs: number;
    queries: string[];
    urlsScraped: number;
    urlsDeduped: number;
  }) => void;
  abortSignal?: AbortSignal;
}

/**
 * Creates the STRICTLY SINGLE tool exposed to the LLM: `web_search`.
 *
 * CRITICAL INVARIANT: This is the sole tool registered with the LLM.
 * Its description instructs the LLM to batch up to 5 entity queries into `queries: string[]`
 * in a single turn, pass `since_date` whenever historical context provides a reference date,
 * and enable `deep_scrape_top_urls` for SaaS pricing and changelog verification.
 */
export function createWebSearchTool(deps?: Partial<WebSearchToolDependencies>) {
  const provider = deps?.searchProvider || createSearchProvider();
  const seenUrls = deps?.seenUrls || new Set<string>();

  return tool({
    description:
      'The single web search and verification tool. Accepts 1 to 5 targeted search queries to execute concurrently in a single batch turn. When verifying multiple tools/companies from historical context (e.g., CRM shortlists or Postgres hosts), pass one specific query per entity. Pass since_date (YYYY-MM-DD) from historical context to prioritize pricing changes or changelogs since that date. Leave deep_scrape_top_urls as true to automatically deep-scrape official pricing tables and specifications into clean Markdown.',
    parameters: WebSearchInputSchema,
    execute: async (input: WebSearchInput): Promise<SearchExecutionResult> => {
      const startTime = performance.now();

      let result: SearchExecutionResult;

      // Use provider's executeSearch if available
      if (typeof provider.executeSearch === 'function') {
        result = await provider.executeSearch(
          input,
          seenUrls,
          deps?.onPhaseEvent,
          deps?.abortSignal
        );
      } else {
        // Fallback execution via standard search
        deps?.onPhaseEvent?.({
          phase: 'search_fanout',
          status: 'started',
          detail: `Searching ${input.queries.length} queries in parallel: ${input.queries.map((q) => `"${q}"`).join(', ')}`,
          timestamp: new Date().toISOString(),
        });

        const subResults = await provider.search(input.queries, {
          since_date: input.since_date,
          sinceDate: input.since_date,
          abortSignal: deps?.abortSignal,
        });

        const totalResultsCount = subResults.reduce(
          (acc, curr) => acc + (curr.results?.length || 0),
          0
        );

        deps?.onPhaseEvent?.({
          phase: 'search_fanout',
          status: 'completed',
          detail: `Retrieved ${totalResultsCount} results across ${input.queries.length} queries.`,
          timestamp: new Date().toISOString(),
          durationMs: Math.round(performance.now() - startTime),
        });

        result = {
          queries: input.queries,
          subResults,
          scrapedPages: [],
          dedupedUrls: Array.from(seenUrls),
          totalResultsCount,
          latencyMs: Math.round(performance.now() - startTime),
        };
      }

      // Enforce final serialized output budget: strictly <= 5,200 chars (~1,300 tokens)
      let serialized = JSON.stringify(result);
      if (serialized.length > 5200) {
        // Trim lower-ranked snippets and scraped content to stay within budget
        for (const sub of result.subResults) {
          for (const item of sub.results) {
            if (item.snippet && item.snippet.length > 140) {
              item.snippet = item.snippet.slice(0, 140) + '...';
            }
          }
        }
        for (const page of result.scrapedPages) {
          if (page.markdownContent && page.markdownContent.length > 500) {
            page.markdownContent = page.markdownContent.slice(0, 500) + '... [budget capped]';
          }
        }
        serialized = JSON.stringify(result);
        if (serialized.length > 5200) {
          // If still over 5200, retain top scraped page only
          result.scrapedPages = result.scrapedPages.slice(0, 1);
        }
      }

      // Emit search metric callback if provided
      deps?.onSearchMetric?.({
        fanoutMs: result.latencyMs,
        queries: result.queries,
        urlsScraped: result.scrapedPages.length,
        urlsDeduped: seenUrls.size,
      });

      return result;
    },
  });
}
