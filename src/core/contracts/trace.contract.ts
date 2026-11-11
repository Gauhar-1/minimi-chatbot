/**
 * Observability & Telemetry contracts for X-Ray Drawer and SSE Stream events.
 */

export type PipelinePhaseType =
  | 'temporal_parse'
  | 'memory_recall'
  | 'search_fanout'
  | 'deep_scrape'
  | 'response_synthesis';

export type PipelinePhaseStatus = 'started' | 'completed' | 'failed' | 'info';

export interface PipelinePhaseEvent {
  phase: PipelinePhaseType;
  status: PipelinePhaseStatus;
  detail: string;
  timestamp: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TurnTracePayload {
  traceId: string;
  sessionId: string;
  userPrompt: string;
  timestampUtc: string;
  temporalResolution?: {
    raw: string;
    startUtc: string;
    endUtc: string;
    resolvedDaysAgo?: number;
  };
  memoryRecall?: {
    status: string;
    rrfMatchedCount: number;
    matchedEntities: string[];
    latencyMs: number;
  };
  searchExecution?: {
    queriesExecuted: string[];
    urlsScraped: string[];
    totalResults: number;
    latencyMs: number;
  };
  latencies: {
    recallMs: number;
    searchFanoutMs: number;
    scrapeMs: number;
    ttftMs?: number;
    totalMs: number;
  };
  events: PipelinePhaseEvent[];
}

export interface ITraceLogger {
  /**
   * Persists a full turn trace payload to SQLite for observability.
   */
  logTrace(trace: TurnTracePayload): Promise<void>;

  /**
   * Retrieves recent traces for a session or globally.
   */
  getTraces(sessionId?: string, limit?: number): Promise<TurnTracePayload[]>;

  /**
   * Retrieves a single trace by ID.
   */
  getTraceById(traceId: string): Promise<TurnTracePayload | null>;
}

