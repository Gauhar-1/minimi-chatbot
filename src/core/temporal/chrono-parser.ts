import * as chrono from 'chrono-node';
import type { TemporalWindow } from '@/core/contracts/memory.contract';

/**
 * Common English question and filler stop-words to exclude when extracting
 * domain keywords for FTS5 lexical matching and semantic vector recall.
 */
const TEMPORAL_AND_FILLER_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'can\'t', 'cannot', 'could',
  'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t',
  'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s',
  'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is',
  'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most',
  'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over',
  'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should',
  'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they',
  'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d',
  'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when',
  'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom',
  'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d',
  'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
  // Conversational / temporal filler words:
  'ask', 'asked', 'tell', 'told', 'show', 'shown', 'answer', 'correct', 'still',
  'since', 'today', 'yesterday', 'tomorrow', 'now', 'last', 'past', 'recent',
  'recently', 'previous', 'previously', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'week', 'month', 'year',
]);

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export class TemporalParser {
  /**
   * Deterministically parses temporal references in user queries.
   *
   * Rules enforced:
   * 1. Uses chrono-node with { forwardDate: false } anchored to referenceDate (default: now).
   * 2. Edge case: Saying "On Monday" on a Monday resolves to 7 days ago (00:00:00 to 23:59:59 UTC),
   *    never today's incomplete session.
   * 3. Edge case: "3 November" resolves to the most recent past Nov 3 (00:00:00 to 23:59:59 UTC).
   * 4. Extracts clean search keywords stripped of temporal stop-words.
   */
  public static parse(prompt: string, referenceDate: Date = new Date()): TemporalWindow {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return {
        hasTemporalReference: false,
        searchKeywords: [],
      };
    }

    // Parse with backward-looking bias (historical recall)
    const chronoResults = chrono.parse(prompt, referenceDate, { forwardDate: false });

    if (chronoResults.length === 0) {
      return {
        hasTemporalReference: false,
        searchKeywords: this.extractKeywords(prompt, ''),
      };
    }

    const firstResult = chronoResults[0];
    const rawExpression = firstResult.text;
    const lowerExpression = rawExpression.toLowerCase();

    // Get the parsed start date
    let parsedStartDate = firstResult.start.date();

    const refDayOfWeek = referenceDate.getUTCDay();
    const parsedDayOfWeek = parsedStartDate.getUTCDay();

    // Check if the temporal expression specifically references a weekday
    const mentionedWeekdayIndex = WEEKDAY_NAMES.findIndex((day) =>
      lowerExpression.includes(day)
    );

    const timeDiffMs = Math.abs(referenceDate.getTime() - parsedStartDate.getTime());
    const isWithin24HoursOfRef = timeDiffMs < 24 * 60 * 60 * 1000;

    // Edge Case: If user says "On Monday" when today is Monday (or any weekday match today),
    // resolve to exactly 7 days ago (the prior week's full day).
    if (mentionedWeekdayIndex !== -1) {
      if (
        refDayOfWeek === mentionedWeekdayIndex &&
        (isWithin24HoursOfRef || parsedDayOfWeek === refDayOfWeek)
      ) {
        parsedStartDate = new Date(parsedStartDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      }
    }

    // Determine the UTC boundaries: 00:00:00.000Z to 23:59:59.999Z
    const year = parsedStartDate.getUTCFullYear();
    const month = parsedStartDate.getUTCMonth();
    const day = parsedStartDate.getUTCDate();

    const startUtcDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));

    let endUtcDate: Date;
    if (firstResult.end) {
      const parsedEndDate = firstResult.end.date();
      endUtcDate = new Date(
        Date.UTC(
          parsedEndDate.getUTCFullYear(),
          parsedEndDate.getUTCMonth(),
          parsedEndDate.getUTCDate(),
          23,
          59,
          59,
          999
        )
      );
    } else {
      endUtcDate = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
    }

    const startUtc = startUtcDate.toISOString();
    const endUtc = endUtcDate.toISOString();

    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const sinceDateIso = `${year}-${monthStr}-${dayStr}`;

    const resolvedDaysAgo = Math.max(
      0,
      Math.floor((referenceDate.getTime() - startUtcDate.getTime()) / (24 * 60 * 60 * 1000))
    );

    const searchKeywords = this.extractKeywords(prompt, rawExpression);

    return {
      hasTemporalReference: true,
      rawExpression,
      startUtc,
      endUtc,
      sinceDateIso,
      searchKeywords,
      resolvedDaysAgo,
    };
  }

  /**
   * Extracts clean domain keywords from prompt by stripping matched temporal
   * expressions, punctuation, and common stop-words.
   */
  public static extractKeywords(prompt: string, temporalExpression: string): string[] {
    let sanitized = prompt;

    // Remove the matched temporal phrase if provided
    if (temporalExpression) {
      sanitized = sanitized.replace(new RegExp(temporalExpression, 'gi'), ' ');
    }

    // Remove non-alphanumeric characters (preserve hyphens within words like "20-person")
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s-]/g, ' ');

    const tokens = sanitized
      .split(/\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 2);

    const keywords: string[] = [];
    const seen = new Set<string>();

    for (const token of tokens) {
      // Clean leading/trailing hyphens
      const cleaned = token.replace(/^-+|-+$/g, '');
      if (cleaned.length < 2) continue;

      if (!TEMPORAL_AND_FILLER_STOPWORDS.has(cleaned) && !seen.has(cleaned)) {
        seen.add(cleaned);
        keywords.push(cleaned);
      }
    }

    return keywords;
  }
}

