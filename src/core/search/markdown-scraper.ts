import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { ScrapedPageSummary } from '@/core/contracts/search.contract';

const SCRAPE_TIMEOUT_MS = 3500;
const MAX_SCRAPED_CHARS = 900; // Strictly ~225 tokens per page for Groq 8k TPM envelope

const PRICING_CHANGE_TOKEN_REGEX =
  /(\$|€|£|price|pricing|plan|tier|seat|user|mo|month|annual|free|pro|starter|enterprise|changelog|release|launch|shipped|update)/i;

/**
 * Filters raw markdown to retain only high-signal pricing & changelog content:
 * - Markdown table rows (/^\|.*\|$/)
 * - Headings (/^#{1,3}\s/)
 * - Lines matching pricing/product change tokens
 */
export function filterPricingAndChangelogMarkdown(rawMarkdown: string): string {
  const lines = rawMarkdown.split('\n');
  const filteredLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Retain markdown table rows
    if (/^\|.*\|$/.test(trimmed)) {
      filteredLines.push(trimmed);
      continue;
    }

    // Retain markdown headings
    if (/^#{1,3}\s/.test(trimmed)) {
      filteredLines.push(trimmed);
      continue;
    }

    // Retain lines matching pricing/product change tokens
    if (PRICING_CHANGE_TOKEN_REGEX.test(trimmed)) {
      filteredLines.push(trimmed);
    }
  }

  // If filter returned almost nothing (e.g. non-standard format), fallback to first lines
  const result =
    filteredLines.length > 0 ? filteredLines.join('\n') : rawMarkdown.slice(0, MAX_SCRAPED_CHARS);

  return result.length > MAX_SCRAPED_CHARS
    ? result.slice(0, MAX_SCRAPED_CHARS) + '\n... [Truncated at 900 chars]'
    : result;
}

/**
 * Configure Turndown with GitHub Flavored Markdown (GFM)
 * to preserve markdown tables for SaaS pricing comparisons.
 */
function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    hr: '---',
    bulletListMarker: '-',
  });

  service.use(gfm);

  return service;
}

const turndownInstance = createTurndownService();

/**
 * Normalizes a URL by stripping tracking params (UTM, ref) and trailing slashes.
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref',
      'gclid',
      'fbclid',
    ];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    parsed.hash = '';

    let clean = parsed.toString();
    if (clean.endsWith('/') && parsed.pathname !== '/') {
      clean = clean.slice(0, -1);
    }
    return clean;
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Heuristic to detect whether a URL points to an official pricing, changelog, or release page.
 */
export function isPricingOrChangelogUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const keywords = ['pricing', 'price', 'plans', 'changelog', 'releases', 'updates', 'features'];
    return keywords.some((kw) => pathname.includes(kw));
  } catch {
    const lower = url.toLowerCase();
    return (
      lower.includes('pricing') ||
      lower.includes('plans') ||
      lower.includes('changelog') ||
      lower.includes('releases')
    );
  }
}

/**
 * Scrapes a target URL and converts its content into clean GitHub-Flavored Markdown.
 *
 * Enforces:
 * - Strict 3,500ms AbortController timeout.
 * - Browser-like User-Agent headers.
 * - Readability parsing with fallback to direct DOM containers (main, article, table, pricing-grid)
 *   if Readability produces < 250 characters on grid-heavy SaaS pricing pages.
 * - Token budget guard: Hard cap at 4,800 characters (~1,200 tokens).
 * - Graceful failure: Returns null on 403/429/Cloudflare or timeout without throwing.
 */
export async function scrapeUrlToMarkdown(
  targetUrl: string,
  timeoutMs: number = SCRAPE_TIMEOUT_MS
): Promise<ScrapedPageSummary | null> {
  const normalized = normalizeUrl(targetUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(normalized, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    clearTimeout(timer);

    // If HTTP error code (403, 429, 5xx) -> return null gracefully without throwing
    if (!response.ok || response.status === 403 || response.status === 429) {
      return null;
    }

    const html = await response.text();

    // Cloudflare challenge detection
    if (
      html.includes('cf-browser-verification') ||
      html.includes('Cloudflare Ray ID') ||
      html.includes('Just a moment...')
    ) {
      return null;
    }

    const dom = new JSDOM(html, { url: normalized });
    const doc = dom.window.document;

    // Strip elements that clutter article extraction
    const elementsToRemove = doc.querySelectorAll(
      'script, style, noscript, iframe, svg, nav, footer, header, aside, form, [role="banner"], [role="navigation"]'
    );
    elementsToRemove.forEach((el) => el.remove());

    const reader = new Readability(doc, { charThreshold: 40 });
    const article = reader.parse();

    const title = article?.title || doc.title || normalized;
    let rawHtml = article?.content || '';

    // Pricing Page Fallback:
    // SaaS /pricing pages often use grid divs that Readability strips.
    // If Readability returns < 250 characters, fall back to extracting main, article,
    // table, or pricing-related containers directly from JSDOM document body.
    if (!rawHtml || rawHtml.trim().length < 250) {
      const pricingContainer =
        doc.querySelector(
          'main, [role="main"], article, .pricing, #pricing, .pricing-table, .pricing-grid, table'
        ) || doc.body;

      if (pricingContainer) {
        rawHtml = pricingContainer.innerHTML;
      }
    }

    if (!rawHtml || rawHtml.trim().length === 0) {
      return null;
    }

    let markdown = turndownInstance.turndown(rawHtml);

    // Clean excessive empty lines
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

    if (!markdown) {
      return null;
    }

    // Apply Signal-Dense Pricing & Changelog Filter (strictly capped at 900 chars / ~225 tokens)
    markdown = filterPricingAndChangelogMarkdown(markdown);

    const charCount = markdown.length;
    const tokenCountEstimate = Math.ceil(charCount / 4);

    return {
      url: normalized,
      title,
      markdownContent: markdown,
      tokenCountEstimate,
      characterCount: charCount,
      statusCode: response.status,
      scrapeSuccess: true,
    };
  } catch {
    clearTimeout(timer);
    // Timeout or network error -> return null gracefully without throwing
    return null;
  }
}

export class MarkdownScraper {
  public static async scrapeUrl(
    targetUrl: string,
    timeoutMs: number = SCRAPE_TIMEOUT_MS
  ): Promise<ScrapedPageSummary> {
    const result = await scrapeUrlToMarkdown(targetUrl, timeoutMs);
    if (!result) {
      return {
        url: normalizeUrl(targetUrl),
        title: '',
        markdownContent: '',
        tokenCountEstimate: 0,
        characterCount: 0,
        scrapeSuccess: false,
        error: 'Scrape failed or blocked',
      };
    }
    return result;
  }

  public static htmlToMarkdown(
    html: string,
    url: string,
    statusCode = 200
  ): ScrapedPageSummary {
    try {
      const dom = new JSDOM(html, { url });
      const doc = dom.window.document;

      const elementsToRemove = doc.querySelectorAll(
        'script, style, noscript, iframe, svg, nav, footer, header, aside, form, [role="banner"], [role="navigation"]'
      );
      elementsToRemove.forEach((el) => el.remove());

      const reader = new Readability(doc, { charThreshold: 40 });
      const article = reader.parse();

      const title = article?.title || doc.title || url;
      let rawHtml = article?.content || '';

      if (!rawHtml || rawHtml.trim().length < 250) {
        const container = doc.querySelector('main, article, table, .pricing') || doc.body;
        if (container) rawHtml = container.innerHTML;
      }

      let markdown = turndownInstance.turndown(rawHtml);
      markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

      markdown = filterPricingAndChangelogMarkdown(markdown);

      const charCount = markdown.length;
      return {
        url,
        title,
        markdownContent: markdown,
        tokenCountEstimate: Math.ceil(charCount / 4),
        characterCount: charCount,
        statusCode,
        scrapeSuccess: true,
      };
    } catch (err) {
      return {
        url,
        title: '',
        markdownContent: '',
        tokenCountEstimate: 0,
        characterCount: 0,
        statusCode,
        scrapeSuccess: false,
        error: `HTML parsing failure: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
