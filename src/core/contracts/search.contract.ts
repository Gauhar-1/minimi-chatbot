import { z } from 'zod';
import type { PipelinePhaseEvent } from './trace.contract';

/**
 * Zod schema defining the input arguments for the single `web_search` tool.
 * Enables parallel batch fan-out (up to 5 queries) and optional deep pricing scraping.
 */
export const WebSearchInputSchema = z.object({
  queries: z
    .array(z.string().min(3))
    .min(1)
    .max(5)
    .describe(
      '1 to 5 specific search queries to execute in parallel. When checking multiple tools/companies from historical context, pass one targeted query per entity in a single batch call.'
    ),
  since_date: z
    .string()
    .optional()
    .describe(
      'Optional ISO date (YYYY-MM-DD) from the historical conversation to focus on pricing changes, changelogs, or releases since that date.'
    ),
  deep_scrape_top_urls: z
    .boolean()
    .default(true)
    .describe(
      'Set to true when verifying SaaS pricing tiers, changelogs, or technical specs so top URLs are scraped into clean Markdown tables.'
    ),
});

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  publishedDate?: string;
}

export interface ScrapedPageSummary {
  url: string;
  title: string;
  markdownContent: string;
  tokenCountEstimate: number;
  characterCount: number;
  statusCode?: number;
  scrapeSuccess: boolean;
  error?: string;
}

export interface SubQueryResult {
  query: string;
  status: 'fulfilled' | 'rejected';
  results: SearchResultItem[];
  warning?: string;
  latencyMs: number;
}

export interface SearchExecutionResult {
  queries: string[];
  subResults: SubQueryResult[];
  scrapedPages: ScrapedPageSummary[];
  dedupedUrls: string[];
  totalResultsCount: number;
  latencyMs: number;
}

export interface SearchProviderOptions {
  since_date?: string;
  sinceDate?: string;
  deep_scrape_top_urls?: boolean;
  deepScrapeTopUrls?: boolean;
  seenUrls?: Set<string>;
  onTelemetry?: (event: PipelinePhaseEvent) => void;
  abortSignal?: AbortSignal;
}

export interface ISearchProvider {
  /**
   * Executes fan-out search queries concurrently via Promise.allSettled with timeout & backoff.
   */
  search(
    queries: string[],
    options?: SearchProviderOptions
  ): Promise<SubQueryResult[]>;

  /**
   * Full search execution supporting batch query fan-out, cross-step URL deduplication,
   * domain ranking, and deep pricing scraping.
   */
  executeSearch?(
    input: {
      queries: string[];
      since_date?: string;
      deep_scrape_top_urls?: boolean;
    },
    seenUrls?: Set<string>,
    onTelemetry?: (event: PipelinePhaseEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<SearchExecutionResult>;
}
