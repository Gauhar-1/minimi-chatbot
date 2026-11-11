import { JSDOM } from 'jsdom';
import type {
  ISearchProvider,
  SearchProviderOptions,
  SearchResultItem,
  SubQueryResult,
  SearchExecutionResult,
  ScrapedPageSummary,
} from '@/core/contracts/search.contract';
import type { PipelinePhaseEvent } from '@/core/contracts/trace.contract';
import {
  scrapeUrlToMarkdown,
  normalizeUrl,
  isPricingOrChangelogUrl,
} from './markdown-scraper';

const SEARCH_TIMEOUT_MS = 8000;
const TAVILY_API_URL = 'https://api.tavily.com/search';

/**
 * Domain boost and SEO listicle deprioritization scoring.
 */
function scoreCandidateUrl(url: string, baseScore = 0.5): number {
  let score = baseScore;
  const lower = url.toLowerCase();

  // Boost official pricing and changelog paths
  if (isPricingOrChangelogUrl(url)) {
    score += 2.5;
  }

  // Boost official company blogs or updates
  if (lower.includes('/blog') || lower.includes('/news') || lower.includes('/docs')) {
    score += 1.0;
  }

  // Deprioritize third-party SEO listicles and aggregators
  const seoListicles = [
    'g2.com',
    'capterra.com',
    'trustradius.com',
    'softwareadvice.com',
    'forbes.com',
    'reddit.com',
    'quora.com',
    'medium.com',
  ];
  if (seoListicles.some((agg) => lower.includes(agg))) {
    score -= 1.5;
  }

  return score;
}

/**
 * Primary search provider implementing ISearchProvider with Tavily API,
 * parallel query fan-out, retry with jittered backoff, and DuckDuckGo HTML fallback.
 */
export class TavilySearchProvider implements ISearchProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = (apiKey || process.env.TAVILY_API_KEY || '').trim();
  }

  /**
   * Basic ISearchProvider search contract.
   */
  public async search(
    queries: string[],
    options?: SearchProviderOptions
  ): Promise<SubQueryResult[]> {
    const searchPromises = queries.map((query) =>
      this.executeSingleQueryWithFallback(query, options)
    );

    const settled = await Promise.allSettled(searchPromises);

    return settled.map((result, idx) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        query: queries[idx],
        status: 'rejected',
        results: [],
        warning: `Search error on query "${queries[idx]}": ${result.reason?.message || String(result.reason)}`,
        latencyMs: 0,
      };
    });
  }

  /**
   * Full search execution supporting batch query fan-out, cross-step URL deduplication,
   * domain ranking, and deep pricing scraping.
   */
  public async executeSearch(
    input: {
      queries: string[];
      since_date?: string;
      deep_scrape_top_urls?: boolean;
    },
    seenUrls: Set<string> = new Set<string>(),
    onTelemetry?: (event: PipelinePhaseEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<SearchExecutionResult> {
    const startTime = performance.now();
    const queries = input.queries.slice(0, 5);

    onTelemetry?.({
      phase: 'search_fanout',
      status: 'started',
      detail: `Executing parallel search across ${queries.length} queries: ${queries.map((q) => `"${q}"`).join(', ')}`,
      timestamp: new Date().toISOString(),
    });

    // 1. Parallel sub-query execution
    const subResults = await this.search(queries, {
      sinceDate: input.since_date,
      abortSignal,
    });

    const totalResultsCount = subResults.reduce(
      (acc, curr) => acc + (curr.results?.length || 0),
      0
    );

    onTelemetry?.({
      phase: 'search_fanout',
      status: 'completed',
      detail: `Retrieved ${totalResultsCount} results across ${queries.length} parallel queries.`,
      timestamp: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startTime),
    });

    // 2. Candidate extraction, domain boosting, and cross-step deduplication
    interface RankedCandidate {
      url: string;
      score: number;
      domain: string;
    }

    const candidateUrls: RankedCandidate[] = [];
    const seenInTurn = new Set<string>();

    for (const sub of subResults) {
      for (const item of sub.results) {
        if (!item.url || !item.url.startsWith('http')) continue;
        const normalized = normalizeUrl(item.url);

        if (seenUrls.has(normalized) || seenInTurn.has(normalized)) {
          continue;
        }

        seenInTurn.add(normalized);

        let domain = '';
        try {
          domain = new URL(normalized).hostname;
        } catch {
          domain = normalized;
        }

        const score = scoreCandidateUrl(normalized, item.score ?? 0.5);
        candidateUrls.push({ url: normalized, score, domain });
      }
    }

    // Sort candidates descending by score
    candidateUrls.sort((a, b) => b.score - a.score);

    // Pick up to 2 highest-priority unique domains for deep scraping (Groq TPM budget)
    const urlsToScrape: string[] = [];
    const usedDomains = new Set<string>();

    if (input.deep_scrape_top_urls !== false) {
      for (const candidate of candidateUrls) {
        if (urlsToScrape.length >= 2) break;
        if (!usedDomains.has(candidate.domain)) {
          usedDomains.add(candidate.domain);
          urlsToScrape.push(candidate.url);
          seenUrls.add(candidate.url);
        }
      }

      // If fewer than 2, add remaining candidates
      if (urlsToScrape.length < 2) {
        for (const candidate of candidateUrls) {
          if (urlsToScrape.length >= 2) break;
          if (!seenUrls.has(candidate.url)) {
            urlsToScrape.push(candidate.url);
            seenUrls.add(candidate.url);
          }
        }
      }
    }

    // 3. Parallel deep scraping of selected pages
    const scrapedPages: ScrapedPageSummary[] = [];

    if (urlsToScrape.length > 0) {
      const scrapeStart = performance.now();
      onTelemetry?.({
        phase: 'deep_scrape',
        status: 'started',
        detail: `Deep-scraping live pricing & changelog tables from ${urlsToScrape.length} top vendor URLs...`,
        timestamp: new Date().toISOString(),
      });

      const scrapePromises = urlsToScrape.map((url) => scrapeUrlToMarkdown(url, 3500));
      const scrapeSettled = await Promise.allSettled(scrapePromises);

      for (const res of scrapeSettled) {
        if (res.status === 'fulfilled' && res.value !== null) {
          scrapedPages.push(res.value);
        }
      }

      onTelemetry?.({
        phase: 'deep_scrape',
        status: 'completed',
        detail: `Deep scraping complete. Clean Markdown tables extracted from ${scrapedPages.length}/${urlsToScrape.length} pages.`,
        timestamp: new Date().toISOString(),
        durationMs: Math.round(performance.now() - scrapeStart),
      });
    }

    return {
      queries,
      subResults,
      scrapedPages,
      dedupedUrls: Array.from(seenUrls),
      totalResultsCount,
      latencyMs: Math.round(performance.now() - startTime),
    };
  }

  private async executeSingleQueryWithFallback(
    query: string,
    options?: SearchProviderOptions
  ): Promise<SubQueryResult> {
    if (this.apiKey) {
      try {
        return await this.executeTavilySingle(query, options);
      } catch (err) {
        console.warn(
          `[TavilySearch] Query "${query}" failed on Tavily. Falling back to DuckDuckGo HTML...`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Fallback: DuckDuckGo HTML
    return this.executeDuckDuckGoSingle(query, options);
  }

  private async executeTavilySingle(
    query: string,
    options?: SearchProviderOptions
  ): Promise<SubQueryResult> {
    const startTime = performance.now();
    let attempt = 0;
    const maxAttempts = 2; // Initial attempt + 1 retry on 429/503

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

      if (options?.abortSignal) {
        options.abortSignal.addEventListener('abort', () => controller.abort(), {
          once: true,
        });
      }

      try {
        const payload: Record<string, unknown> = {
          api_key: this.apiKey,
          query: options?.sinceDate || options?.since_date
            ? `${query} since ${options.sinceDate || options.since_date}`
            : query,
          search_depth: 'basic',
          include_answer: false,
          include_raw_content: false,
          max_results: 5,
        };

        const response = await fetch(TAVILY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 429 || response.status === 503) {
          if (attempt < maxAttempts) {
            const jitter = 400 + Math.floor(Math.random() * 200);
            await new Promise((resolve) => setTimeout(resolve, jitter));
            continue;
          }
        }

        if (!response.ok) {
          throw new Error(`Tavily HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as {
          results?: Array<{
            title?: string;
            url?: string;
            content?: string;
            score?: number;
            published_date?: string;
          }>;
        };

        const results: SearchResultItem[] = (data.results || []).slice(0, 2).map((item) => ({
          title: item.title || '',
          url: item.url || '',
          snippet: (item.content || '').slice(0, 280),
          score: item.score ?? 0.8,
          publishedDate: item.published_date,
        }));

        return {
          query,
          status: 'fulfilled',
          results,
          latencyMs: Math.round(performance.now() - startTime),
        };
      } catch (err) {
        clearTimeout(timeoutId);
        if (attempt >= maxAttempts) {
          throw err;
        }
      }
    }

    throw new Error(`All Tavily attempts exhausted for query: "${query}"`);
  }

  private async executeDuckDuckGoSingle(
    query: string,
    options?: SearchProviderOptions
  ): Promise<SubQueryResult> {
    const startTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    if (options?.abortSignal) {
      options.abortSignal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    try {
      const searchQuery =
        options?.sinceDate || options?.since_date
          ? `${query} ${options.sinceDate || options.since_date}`
          : query;

      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
      }

      const html = await response.text();
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const resultElements = doc.querySelectorAll('.result');

      const results: SearchResultItem[] = [];

      resultElements.forEach((el) => {
        if (results.length >= 2) return;

        const titleAnchor = el.querySelector('.result__title a') as HTMLAnchorElement | null;
        const snippetEl = el.querySelector('.result__snippet');

        if (!titleAnchor) return;

        let realUrl = titleAnchor.href || '';
        if (realUrl.includes('uddg=')) {
          try {
            const parsed = new URL('https://duckduckgo.com' + realUrl);
            const uddg = parsed.searchParams.get('uddg');
            if (uddg) realUrl = uddg;
          } catch {
            // Keep original
          }
        }

        const title = titleAnchor.textContent?.trim() || '';
        const rawSnippet = snippetEl?.textContent?.trim() || '';
        const snippet = rawSnippet.slice(0, 280);

        if (title && realUrl.startsWith('http')) {
          results.push({
            title,
            url: realUrl,
            snippet,
            score: scoreCandidateUrl(realUrl, 0.7),
          });
        }
      });

      return {
        query,
        status: 'fulfilled',
        results,
        latencyMs: Math.round(performance.now() - startTime),
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}

/**
 * Factory creating the resilient search provider.
 */
export function createSearchProvider(apiKey?: string): ISearchProvider {
  return new TavilySearchProvider(apiKey);
}
