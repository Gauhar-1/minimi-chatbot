/**
 * Memory subsystem contracts for deterministic episodic retrieval and compaction.
 * Follows Interface Segregation Principle (IMemoryReader vs IMemoryWriter).
 */

export interface TemporalWindow {
  hasTemporalReference: boolean;
  rawExpression?: string;
  startUtc?: string; // ISO 8601 e.g. "2026-11-09T00:00:00.000Z"
  endUtc?: string;   // ISO 8601 e.g. "2026-11-09T23:59:59.999Z"
  sinceDateIso?: string; // ISO Date e.g. "2026-11-09"
  searchKeywords: string[];
  resolvedDaysAgo?: number;
}

export interface MemoryMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAtUtc: string;
  embedding?: Float32Array;
}

export interface SessionFact {
  id: string;
  sessionId: string;
  factText: string;
  entitiesJson: string; // JSON serialized string array e.g. '["HubSpot", "Attio"]'
  referenceDateUtc: string;
  embedding?: Float32Array;
}

export type MemoryRecallStatus =
  | 'MATCHED'
  | 'EMPTY_FOR_DATE_WINDOW'
  | 'NO_TEMPORAL_CONSTRAINT';

export interface RecalledContext {
  recallStatus: MemoryRecallStatus;
  temporalWindow?: TemporalWindow;
  matchedMessages: MemoryMessage[];
  matchedFacts: SessionFact[];
  formattedHistoricalContext: string;
  rrfScores: Record<string, number>;
  totalCandidateCount: number;
  latencyMs: number;
}

export interface IMemoryReader {
  /**
   * Performs hybrid RRF search across temporal window, FTS5 lexical BM25,
   * and in-process vector cosine similarity.
   */
  recallContext(query: string, temporalWindow?: TemporalWindow): Promise<RecalledContext>;

  /**
   * Retrieves messages for a specific session ID ordered by creation time.
   */
  getRecentSession(sessionId: string): Promise<MemoryMessage[]>;
}

export interface IMemoryWriter {
  /**
   * Persists a single chat message with its vector embedding.
   */
  saveMessage(message: Omit<MemoryMessage, 'id'> & { id?: string }): Promise<string>;

  /**
   * Persists an atomic distilled fact with its vector embedding.
   */
  saveFact(fact: Omit<SessionFact, 'id'> & { id?: string }): Promise<string>;

  /**
   * Persists a batch of messages in a single SQLite transaction.
   */
  saveBatchMessages(messages: Array<Omit<MemoryMessage, 'id'> & { id?: string }>): Promise<void>;
}

