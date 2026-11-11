import { streamText, type CoreMessage } from 'ai';
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

export interface OrchestratorRunOptions {
  sessionId: string;
  userPrompt: string;
  conversationHistory?: CoreMessage[];
  onPhaseEvent?: (event: PipelinePhaseEvent) => void;
  onTraceComplete?: (trace: TurnTracePayload) => void;
  abortSignal?: AbortSignal;
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

    const messages: CoreMessage[] = [
      ...(options.conversationHistory || []),
      { role: 'user', content: options.userPrompt },
    ];

    // Measure Time-To-First-Token (TTFT)
    let firstTokenTime: number | null = null;
    let ttftMs: number | undefined = undefined;

    const stream = streamText({
      model,
      system: systemPrompt,
      messages,
      tools: {
        web_search: webSearchTool,
      },
      maxSteps: 4,
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
      },
      onFinish: async (event) => {
        try {
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
            content: event.text,
            createdAtUtc: new Date().toISOString(),
          });

          // Stage 4: Non-blocking asynchronous post-turn fact extraction
          extractAndSaveTurnFacts(
            options.sessionId,
            options.userPrompt,
            event.text,
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

    return {
      stream,
      traceId,
      temporalWindow,
      recalledContext,
      providerName,
      modelName,
    };
  }
}
