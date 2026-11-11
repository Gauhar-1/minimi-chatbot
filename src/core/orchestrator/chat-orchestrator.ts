import { streamText, generateText, type CoreMessage } from 'ai';
import { TemporalParser } from '@/core/temporal/chrono-parser';
import { HybridMemoryEngine } from '@/core/memory/hybrid-retriever';
import { SQLiteTraceLogger } from './trace-logger';
import { extractAndSaveTurnFacts } from '@/core/memory/fact-compactor';
import { resolveLanguageModel } from './model-factory';
import { buildSystemPrompt } from './system-prompt';
import { createWebSearchTool } from '@/core/search/web-search.tool';
import { createSearchProvider } from '@/core/search/tavily.provider';
import type {
  TurnTracePayload,
  PipelinePhaseEvent,
  ITraceLogger,
} from '@/core/contracts/trace.contract';
import type { IMemoryReader, IMemoryWriter } from '@/core/contracts/memory.contract';

import type { DataStreamWriter } from 'ai';

export interface OrchestratorRunOptions {
  sessionId: string;
  userPrompt: string;
  conversationHistory?: CoreMessage[];
  onPhaseEvent?: (event: PipelinePhaseEvent) => void;
  onTraceComplete?: (trace: TurnTracePayload) => void;
  abortSignal?: AbortSignal;
  dataStream?: DataStreamWriter;
}

export class ChatOrchestrator {
  private memoryReader: IMemoryReader;
  private memoryWriter: IMemoryWriter;
  private traceLogger: ITraceLogger;

  constructor(
    memoryReader?: IMemoryReader,
    memoryWriter?: IMemoryWriter,
    traceLogger?: ITraceLogger
  ) {
    const memoryEngine = new HybridMemoryEngine();
    this.memoryReader = memoryReader || memoryEngine;
    this.memoryWriter = memoryWriter || memoryEngine;
    this.traceLogger = traceLogger || new SQLiteTraceLogger();
  }

  /**
   * Coordinates the 4-stage sequential pipeline:
   * 1. Stage 1: Deterministic Temporal Grounding (chrono-node)
   * 2. Stage 2: Hybrid Episodic Memory Recall (FTS5 BM25 + Vectors + RRF k=60)
   * 3. Stage 3: Strict Single-Tool Agentic Execution (web_search) with TTFT measurement
   * 4. Stage 4: Trace Logging & Async Non-Blocking Fact Compaction
   */
  public async executePipeline(options: OrchestratorRunOptions) {
    const totalStartTime = performance.now();
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const events: PipelinePhaseEvent[] = [];

    const emitEvent = (event: PipelinePhaseEvent) => {
      events.push(event);
      options.onPhaseEvent?.(event);
    };

    // =========================================================================
    // Stage 1: Deterministic Temporal Grounding
    // =========================================================================
    const parseStart = performance.now();
    emitEvent({
      phase: 'temporal_parse',
      status: 'started',
      detail: `Parsing temporal expressions in user prompt: "${options.userPrompt.slice(0, 50)}..."`,
      timestamp: new Date().toISOString(),
    });

    const temporalWindow = TemporalParser.parse(options.userPrompt);
    const parseDurationMs = Math.round(performance.now() - parseStart);

    emitEvent({
      phase: 'temporal_parse',
      status: 'completed',
      detail: temporalWindow.hasTemporalReference
        ? `Resolved "${temporalWindow.rawExpression}" ➔ ${temporalWindow.startUtc?.split('T')[0]} (${temporalWindow.resolvedDaysAgo}d ago)`
        : 'No explicit temporal constraints detected in user query.',
      timestamp: new Date().toISOString(),
      durationMs: parseDurationMs,
      metadata: { temporalWindow },
    });

    // =========================================================================
    // Stage 2: Hybrid Episodic Memory Recall (RRF)
    // =========================================================================
    emitEvent({
      phase: 'memory_recall',
      status: 'started',
      detail: 'Querying SQLite FTS5 BM25, local embeddings, and temporal window ranking...',
      timestamp: new Date().toISOString(),
    });

    const recalledContext = await this.memoryReader.recallContext(
      options.userPrompt,
      temporalWindow
    );

    emitEvent({
      phase: 'memory_recall',
      status: 'completed',
      detail:
        recalledContext.recallStatus === 'EMPTY_FOR_DATE_WINDOW'
          ? `[Guard] Zero records exist for date window (${recalledContext.latencyMs}ms)`
          : `Recalled ${recalledContext.matchedMessages.length} messages and ${recalledContext.matchedFacts.length} atomic facts (${recalledContext.latencyMs}ms)`,
      timestamp: new Date().toISOString(),
      durationMs: recalledContext.latencyMs,
      metadata: {
        recallStatus: recalledContext.recallStatus,
        candidateCount: recalledContext.totalCandidateCount,
      },
    });

    // =========================================================================
    // Stage 3: LLM Model Resolution & Single-Tool Stream Setup
    // =========================================================================
    const systemPrompt = buildSystemPrompt({
      currentUtcIso: new Date().toISOString(),
      temporalWindow,
      recalledContext,
    });

    const { model, providerName, modelName } = resolveLanguageModel();

    // Cross-step deduplication set
    const seenUrls = new Set<string>();
    let searchFanoutDurationMs = 0;
    let scrapeDurationMs = 0;
    const executedQueries: string[] = [];
    let urlsScrapedCount = 0;

    let accumulatedToolResults = '';

    // The STRICTLY SINGLE tool registered with the LLM
    const webSearchTool = createWebSearchTool({
      searchProvider: createSearchProvider(),
      seenUrls,
      onPhaseEvent: emitEvent,
      onSearchMetric: (metric) => {
        searchFanoutDurationMs += metric.fanoutMs;
        executedQueries.push(...metric.queries);
        urlsScrapedCount += metric.urlsScraped;
      },
      abortSignal: options.abortSignal,
    });

    // Persist user prompt to SQLite messages
    await this.memoryWriter.saveMessage({
      sessionId: options.sessionId,
      role: 'user',
      content: options.userPrompt,
      createdAtUtc: new Date().toISOString(),
    });

    // History Slicing (TPM optimization):
    // 1. Filter out old tool invocation/result messages so old heavy search JSON is never re-sent.
    // 2. Take only the last 3 messages so context window remains lightweight (< 4,200 tokens total).
    const cleanedHistory: CoreMessage[] = (options.conversationHistory || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));

    const slicedHistory = cleanedHistory.slice(-3);
    const messages: CoreMessage[] = [
      ...slicedHistory,
      { role: 'user', content: options.userPrompt },
    ];

    // Measure Time-To-First-Token (TTFT)
    let firstTokenTime: number | null = null;
    let ttftMs: number | undefined = undefined;

    // Helper to extract rate limit wait duration
    const parseResetDelayMs = (err: unknown): number => {
      const errorObj = err as Record<string, unknown>;
      const headers = (errorObj.responseHeaders ||
        errorObj.headers ||
        {}) as Record<string, string>;

      const resetTokens = headers['x-ratelimit-reset-tokens'];
      const retryAfter = headers['retry-after'];

      if (resetTokens) {
        const parsedSec = parseFloat(resetTokens.replace(/[^\d.]/g, ''));
        if (!isNaN(parsedSec) && parsedSec > 0) return Math.min(Math.round(parsedSec * 1000) + 500, 15000);
      }
      if (retryAfter) {
        const parsedSec = parseFloat(retryAfter);
        if (!isNaN(parsedSec) && parsedSec > 0) return Math.min(Math.round(parsedSec * 1000) + 500, 15000);
      }
      return 6500; // Default 6.5s rolling window wait
    };

    const isRateLimitOrTooLarge = (err: unknown): { isMatch: boolean; is413: boolean } => {
      const errorObj = err as Record<string, unknown>;
      const status = errorObj.statusCode || errorObj.status;
      const message = String(errorObj.message || err);
      const is413 = status === 413 || /Request too large/i.test(message);
      const is429 = status === 429 || /rate_limit_exceeded|tokens per minute/i.test(message);
      return { isMatch: is413 || is429, is413 };
    };

    const runStream = (activeSystemPrompt: string) => {
      return streamText({
        model,
        system: activeSystemPrompt,
        messages,
        tools: {
          web_search: webSearchTool,
        },
        maxSteps: 3,
        maxTokens: 2048,
        onError: ({ error }) => {
          console.error('[streamText Step Error]:', error);
        },
        onChunk: ({ chunk }) => {
          if (firstTokenTime === null && chunk.type === 'text-delta') {
            firstTokenTime = performance.now();
            ttftMs = Math.round(firstTokenTime - totalStartTime);
          }
        },
        onStepFinish: (step) => {
          if (step.toolCalls) {
            for (const tc of step.toolCalls) {
              if (tc.toolName === 'web_search') {
                const args = tc.args as { queries?: string[] };
                if (args.queries) {
                  for (const q of args.queries) {
                    if (!executedQueries.includes(q)) executedQueries.push(q);
                  }
                }
              }
            }
          }
          if (step.toolResults && step.toolResults.length > 0) {
            for (const tr of step.toolResults) {
              if (tr.result) {
                const res = tr.result as {
                  subResults?: Array<{ query: string; results?: Array<{ title: string; snippet: string }> }>;
                  scrapedPages?: Array<{ title: string; markdownContent: string }>;
                };
                if (res.subResults) {
                  for (const sr of res.subResults) {
                    for (const r of sr.results || []) {
                      accumulatedToolResults += `\n- [${r.title}]: ${r.snippet}`;
                    }
                  }
                }
                if (res.scrapedPages) {
                  for (const p of res.scrapedPages) {
                    accumulatedToolResults += `\n- [Page: ${p.title}]: ${p.markdownContent.slice(0, 300)}`;
                  }
                }
              }
            }
          }
        },
        onFinish: async (event) => {
          try {
            console.log(
              `[streamText onFinish] steps=${event.steps?.length}, finishReason=${event.finishReason}, textLength=${event.text?.length}`
            );
            let finalText = event.text || '';

            // Step-2 Synthesis Fallback: If web_search ran but the model emitted 0 characters
            if (!finalText.trim() && (executedQueries.length > 0 || accumulatedToolResults)) {
              console.warn('[Orchestrator] Empty text returned post-search. Executing tool-free synthesis fallback...');
              emitEvent({
                phase: 'response_synthesis',
                status: 'started',
                detail: 'Synthesizing markdown comparison table from search findings...',
                timestamp: new Date().toISOString(),
              });

              // Brief wait to respect Groq rolling window TPM recovery if needed
              await new Promise((resolve) => setTimeout(resolve, 2500));

              try {
                const compactPrompt = `You are Minimi Temporal Agent. Provide an Executive Verdict and a comparison table for: ${options.userPrompt}`;
                const compactFindings = accumulatedToolResults.slice(0, 1200);

                if (options.dataStream) {
                  const fallbackStream = streamText({
                    model,
                    system: `${compactPrompt}\nDo not output tool calls. Format as Markdown table.`,
                    messages: [
                      {
                        role: 'user',
                        content: `Search findings:\n${compactFindings}\n\nProvide the Executive Verdict and comparison table:`,
                      },
                    ],
                    maxTokens: 1200,
                  });
                  fallbackStream.mergeIntoDataStream(options.dataStream);
                  finalText = await fallbackStream.text;
                } else {
                  const fallbackResult = await generateText({
                    model,
                    system: `${compactPrompt}\nDo not output tool calls. Format as Markdown table.`,
                    messages: [
                      {
                        role: 'user',
                        content: `Search findings:\n${compactFindings}\n\nProvide the Executive Verdict and comparison table:`,
                      },
                    ],
                    maxTokens: 1200,
                  });
                  finalText = fallbackResult.text;
                }
                console.log(`[Orchestrator] Tool-free synthesis fallback succeeded! Length: ${finalText.length}`);
              } catch (fallbackErr) {
                console.error('[Orchestrator] Fallback synthesis error:', fallbackErr);
              }
            }

            const totalDurationMs = Math.round(performance.now() - totalStartTime);

            // Sum scrape duration from events
            for (const ev of events) {
              if (ev.phase === 'deep_scrape' && ev.durationMs) {
                scrapeDurationMs += ev.durationMs;
              }
            }

            const tracePayload: TurnTracePayload = {
              traceId,
              sessionId: options.sessionId,
              userPrompt: options.userPrompt,
              timestampUtc: new Date().toISOString(),
              temporalResolution: temporalWindow.hasTemporalReference
                ? {
                    raw: temporalWindow.rawExpression || '',
                    startUtc: temporalWindow.startUtc || '',
                    endUtc: temporalWindow.endUtc || '',
                    resolvedDaysAgo: temporalWindow.resolvedDaysAgo,
                  }
                : undefined,
              memoryRecall: {
                status: recalledContext.recallStatus,
                rrfMatchedCount:
                  recalledContext.matchedMessages.length + recalledContext.matchedFacts.length,
                matchedEntities: recalledContext.matchedFacts.map((f) => f.factText).slice(0, 3),
                latencyMs: recalledContext.latencyMs,
              },
              searchExecution: {
                queriesExecuted: executedQueries,
                urlsScraped: Array.from(seenUrls),
                totalResults: seenUrls.size,
                latencyMs: searchFanoutDurationMs + scrapeDurationMs,
              },
              latencies: {
                recallMs: recalledContext.latencyMs,
                searchFanoutMs: searchFanoutDurationMs,
                scrapeMs: scrapeDurationMs,
                ttftMs,
                totalMs: totalDurationMs,
              },
              events,
            };

            // Persist trace to SQLite turn_traces
            await this.traceLogger.logTrace(tracePayload);
            options.onTraceComplete?.(tracePayload);

            // Persist assistant reply to SQLite messages
            await this.memoryWriter.saveMessage({
              sessionId: options.sessionId,
              role: 'assistant',
              content: finalText,
              createdAtUtc: new Date().toISOString(),
            });

            // Stage 4: Non-blocking asynchronous post-turn fact extraction
            extractAndSaveTurnFacts(
              options.sessionId,
              options.userPrompt,
              finalText,
              this.memoryWriter,
              new Date().toISOString()
            ).catch((err) => {
              console.warn('[Orchestrator] Async fact compaction warning:', err);
            });
          } catch (err) {
            console.error(
              '[Orchestrator] Post-stream persistence error (trace/message save failed):',
              err instanceof Error ? err.message : String(err)
            );
          }
        },
      });
    };

    let streamResult: ReturnType<typeof runStream>;
    try {
      streamResult = runStream(systemPrompt);
    } catch (err) {
      const check = isRateLimitOrTooLarge(err);
      if (check.isMatch) {
        const delayMs = parseResetDelayMs(err);
        const delaySec = Math.round(delayMs / 1000);
        emitEvent({
          phase: 'tpm_pacing',
          status: 'started',
          detail: `Pacing Groq 8k TPM window, resuming in ${delaySec}s...`,
          timestamp: new Date().toISOString(),
        });

        await new Promise((resolve) => setTimeout(resolve, delayMs));

        let retryPrompt = systemPrompt;
        if (check.is413) {
          // Single payload too big: trim historical context by 40%
          const trimmedLength = Math.round((recalledContext.formattedHistoricalContext?.length || 0) * 0.6);
          const trimmedHistorical = (recalledContext.formattedHistoricalContext || '').slice(0, trimmedLength);
          retryPrompt = buildSystemPrompt({
            currentUtcIso: new Date().toISOString(),
            temporalWindow,
            recalledContext: {
              ...recalledContext,
              formattedHistoricalContext: trimmedHistorical,
            },
          });
        }

        emitEvent({
          phase: 'tpm_pacing',
          status: 'completed',
          detail: 'TPM pacing delay complete, retrying generation turn...',
          timestamp: new Date().toISOString(),
          durationMs: delayMs,
        });

        streamResult = runStream(retryPrompt);
      } else {
        throw err;
      }
    }

    return {
      stream: streamResult,
      traceId,
      temporalWindow,
      recalledContext,
      providerName,
      modelName,
    };
  }
}
