import type Database from 'better-sqlite3';
import { getDatabase } from './sqlite-client';
import { LocalEmbedder } from './local-embedder';
import type {
  IMemoryReader,
  IMemoryWriter,
  MemoryMessage,
  SessionFact,
  TemporalWindow,
  RecalledContext,
} from '@/core/contracts/memory.contract';

const RRF_K = 60;
const TIME_WEIGHT_BOOST = 2.5;
const BASE_WEIGHT = 1.0;
const MAX_CONTEXT_CHARS = 1800; // Strict ~450 token high-density recall cap for 8k TPM Groq envelope

interface DBMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at_utc: string;
  embedding: Buffer | null;
}

interface DBFactRow {
  id: string;
  session_id: string;
  fact_text: string;
  entities_json: string;
  reference_date_utc: string;
  embedding: Buffer | null;
}

export class HybridMemoryEngine implements IMemoryReader, IMemoryWriter {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  // ==========================================
  // IMemoryReader Implementation
  // ==========================================

  public async recallContext(
    query: string,
    temporalWindow?: TemporalWindow
  ): Promise<RecalledContext> {
    const startTime = performance.now();

    // 1. Hallucination Guard: If a temporal constraint was specified, verify records exist within +-24h
    if (temporalWindow?.hasTemporalReference && temporalWindow.startUtc && temporalWindow.endUtc) {
      const guardStart = new Date(
        new Date(temporalWindow.startUtc).getTime() - 24 * 60 * 60 * 1000
      ).toISOString();
      const guardEnd = new Date(
        new Date(temporalWindow.endUtc).getTime() + 24 * 60 * 60 * 1000
      ).toISOString();

      const countRow = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM messages WHERE created_at_utc >= ? AND created_at_utc <= ?`
        )
        .get(guardStart, guardEnd) as { count: number };

      if (!countRow || countRow.count === 0) {
        return {
          recallStatus: 'EMPTY_FOR_DATE_WINDOW',
          temporalWindow,
          matchedMessages: [],
          matchedFacts: [],
          formattedHistoricalContext: `<historical_context>\n[TEMPORAL_MEMORY_NOTICE]: No historical conversations or memory records exist for the requested date window (${temporalWindow.startUtc.split('T')[0]} ±24h).\nINSTRUCTION: Inform the user explicitly that no conversation or data was recorded on that date. Do not hallucinate or guess past shortlists.\n</historical_context>`,
          rrfScores: {},
          totalCandidateCount: 0,
          latencyMs: Math.round(performance.now() - startTime),
        };
      }
    }

    // 2. Temporal Window Ranking (r_time)
    const timeRanks = new Map<string, number>();
    if (temporalWindow?.hasTemporalReference && temporalWindow.startUtc && temporalWindow.endUtc) {
      const startMs = new Date(temporalWindow.startUtc).getTime();
      const endMs = new Date(temporalWindow.endUtc).getTime();
      const midMs = (startMs + endMs) / 2;

      // Select candidate messages near or inside the temporal window
      const messagesInRange = this.db
        .prepare(
          `SELECT id, created_at_utc FROM messages
           ORDER BY ABS(strftime('%s', created_at_utc) * 1000 - ?) ASC
           LIMIT 50`
        )
        .all(midMs) as Array<{ id: string; created_at_utc: string }>;

      messagesInRange.forEach((row, idx) => {
        timeRanks.set(row.id, idx + 1);
      });

      const factsInRange = this.db
        .prepare(
          `SELECT id, reference_date_utc FROM session_facts
           ORDER BY ABS(strftime('%s', reference_date_utc) * 1000 - ?) ASC
           LIMIT 20`
        )
        .all(midMs) as Array<{ id: string; reference_date_utc: string }>;

      factsInRange.forEach((row, idx) => {
        timeRanks.set(row.id, idx + 1);
      });
    }

    // 3. SQLite FTS5 BM25 Lexical Ranking (r_bm25)
    const bm25Ranks = new Map<string, number>();
    const keywords =
      temporalWindow?.searchKeywords && temporalWindow.searchKeywords.length > 0
        ? temporalWindow.searchKeywords
        : query
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length >= 2);

    if (keywords.length > 0) {
      // Sanitize keywords for FTS5: strip internal quotes and escape special characters
      const sanitizedFtsQuery = keywords
        .map((k) => k.replace(/["*]/g, '').trim())
        .filter((k) => k.length >= 2)
        .map((k) => `"${k}"`)
        .join(' OR ');

      if (sanitizedFtsQuery.length > 0) {
        try {
          const ftsRows = this.db
            .prepare(
              `SELECT message_id, bm25(messages_fts) as rank
               FROM messages_fts
               WHERE messages_fts MATCH ?
               ORDER BY rank ASC
               LIMIT 50`
            )
            .all(sanitizedFtsQuery) as Array<{ message_id: string; rank: number }>;

          ftsRows.forEach((row, idx) => {
            bm25Ranks.set(row.message_id, idx + 1);
          });
        } catch {
          // FTS match syntax warning or empty index: fallback gracefully
        }
      }
    }

    // 4. In-process Float32Array Cosine Similarity Ranking (r_vec)
    const vecRanks = new Map<string, number>();
    const queryEmbedding = await LocalEmbedder.embed(query);

    // Retrieve recent message candidates with embeddings
    const allMessages = this.db
      .prepare(
        `SELECT id, session_id, role, content, created_at_utc, embedding
         FROM messages
         ORDER BY created_at_utc DESC
         LIMIT 200`
      )
      .all() as DBMessageRow[];

    const msgSimilarities: Array<{ id: string; similarity: number }> = [];
    for (const msg of allMessages) {
      if (msg.embedding) {
        const vec = LocalEmbedder.blobToVector(msg.embedding);
        const sim = LocalEmbedder.cosineSimilarity(queryEmbedding, vec);
        msgSimilarities.push({ id: msg.id, similarity: sim });
      }
    }

    msgSimilarities.sort((a, b) => b.similarity - a.similarity);
    msgSimilarities.slice(0, 50).forEach((item, idx) => {
      vecRanks.set(item.id, idx + 1);
    });

    // Also compute similarity against session facts
    const allFacts = this.db
      .prepare(
        `SELECT id, session_id, fact_text, entities_json, reference_date_utc, embedding
         FROM session_facts
         ORDER BY reference_date_utc DESC
         LIMIT 100`
      )
      .all() as DBFactRow[];

    const factSimilarities: Array<{ id: string; similarity: number }> = [];
    for (const fact of allFacts) {
      if (fact.embedding) {
        const vec = LocalEmbedder.blobToVector(fact.embedding);
        const sim = LocalEmbedder.cosineSimilarity(queryEmbedding, vec);
        factSimilarities.push({ id: fact.id, similarity: sim });
      }
    }

    factSimilarities.sort((a, b) => b.similarity - a.similarity);
    factSimilarities.slice(0, 20).forEach((item, idx) => {
      vecRanks.set(item.id, idx + 1);
    });

    // 5. Reciprocal Rank Fusion (RRF, k = 60)
    // RRF(d) = w_time / (60 + r_time(d)) + w_bm25 / (60 + r_bm25(d)) + w_vec / (60 + r_vec(d))
    const candidateIds = new Set<string>([
      ...timeRanks.keys(),
      ...bm25Ranks.keys(),
      ...vecRanks.keys(),
    ]);

    const rrfScores: Record<string, number> = {};
    for (const id of candidateIds) {
      const rTime = timeRanks.get(id);
      const rBm25 = bm25Ranks.get(id);
      const rVec = vecRanks.get(id);

      const timeWeight =
        temporalWindow?.hasTemporalReference && rTime !== undefined
          ? TIME_WEIGHT_BOOST
          : BASE_WEIGHT;

      const scoreTime = rTime !== undefined ? timeWeight / (RRF_K + rTime) : 0;
      const scoreBm25 = rBm25 !== undefined ? BASE_WEIGHT / (RRF_K + rBm25) : 0;
      const scoreVec = rVec !== undefined ? BASE_WEIGHT / (RRF_K + rVec) : 0;

      rrfScores[id] = scoreTime + scoreBm25 + scoreVec;
    }

    const sortedIds = Array.from(candidateIds).sort((a, b) => (rrfScores[b] || 0) - (rrfScores[a] || 0));

    // Separate matched messages and matched facts
    const matchedMessages: MemoryMessage[] = [];
    const matchedFacts: SessionFact[] = [];
    const includedSessionIds = new Set<string>();

    const messageMap = new Map<string, DBMessageRow>(allMessages.map((m) => [m.id, m]));
    const factMap = new Map<string, DBFactRow>(allFacts.map((f) => [f.id, f]));

    for (const id of sortedIds) {
      const msg = messageMap.get(id);
      if (msg) {
        matchedMessages.push({
          id: msg.id,
          sessionId: msg.session_id,
          role: msg.role,
          content: msg.content,
          createdAtUtc: msg.created_at_utc,
          embedding: msg.embedding ? LocalEmbedder.blobToVector(msg.embedding) : undefined,
        });
        includedSessionIds.add(msg.session_id);
      }

      const fact = factMap.get(id);
      if (fact) {
        matchedFacts.push({
          id: fact.id,
          sessionId: fact.session_id,
          factText: fact.fact_text,
          entitiesJson: fact.entities_json,
          referenceDateUtc: fact.reference_date_utc,
          embedding: fact.embedding ? LocalEmbedder.blobToVector(fact.embedding) : undefined,
        });
        includedSessionIds.add(fact.session_id);
      }

      if (matchedMessages.length >= 6 && matchedFacts.length >= 4) {
        break;
      }
    }

    // Ensure turn completeness: For any matched assistant message, fetch the corresponding user prompt from that session
    for (const session_id of includedSessionIds) {
      const sessionMessages = this.db
        .prepare(
          `SELECT id, session_id, role, content, created_at_utc, embedding
           FROM messages
           WHERE session_id = ?
           ORDER BY created_at_utc ASC`
        )
        .all(session_id) as DBMessageRow[];

      for (const sMsg of sessionMessages) {
        if (!matchedMessages.some((m) => m.id === sMsg.id)) {
          matchedMessages.push({
            id: sMsg.id,
            sessionId: sMsg.session_id,
            role: sMsg.role,
            content: sMsg.content,
            createdAtUtc: sMsg.created_at_utc,
            embedding: sMsg.embedding ? LocalEmbedder.blobToVector(sMsg.embedding) : undefined,
          });
        }
      }
    }

    // Sort matched messages chronologically
    matchedMessages.sort(
      (a, b) => new Date(a.createdAtUtc).getTime() - new Date(b.createdAtUtc).getTime()
    );

    // 6. Format <historical_context> capped at MAX_CONTEXT_CHARS (2500 tokens)
    const formattedHistoricalContext = this.formatHistoricalContext(
      matchedMessages,
      matchedFacts,
      temporalWindow
    );

    const recallStatus = temporalWindow?.hasTemporalReference
      ? matchedMessages.length > 0 || matchedFacts.length > 0
        ? 'MATCHED'
        : 'EMPTY_FOR_DATE_WINDOW'
      : 'NO_TEMPORAL_CONSTRAINT';

    return {
      recallStatus,
      temporalWindow,
      matchedMessages,
      matchedFacts,
      formattedHistoricalContext,
      rrfScores,
      totalCandidateCount: candidateIds.size,
      latencyMs: Math.round(performance.now() - startTime),
    };
  }

  public async getRecentSession(sessionId: string): Promise<MemoryMessage[]> {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, content, created_at_utc, embedding
         FROM messages
         WHERE session_id = ?
         ORDER BY created_at_utc ASC`
      )
      .all(sessionId) as DBMessageRow[];

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role,
      content: r.content,
      createdAtUtc: r.created_at_utc,
      embedding: r.embedding ? LocalEmbedder.blobToVector(r.embedding) : undefined,
    }));
  }

  // ==========================================
  // IMemoryWriter Implementation
  // ==========================================

  public async saveMessage(
    message: Omit<MemoryMessage, 'id'> & { id?: string }
  ): Promise<string> {
    const id = message.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const vec = message.embedding || (await LocalEmbedder.embed(message.content));
    const blob = LocalEmbedder.vectorToBlob(vec);

    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at_utc, embedding)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, message.sessionId, message.role, message.content, message.createdAtUtc, blob);

    return id;
  }

  public async saveFact(fact: Omit<SessionFact, 'id'> & { id?: string }): Promise<string> {
    const id = fact.id || `fact_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const vec = fact.embedding || (await LocalEmbedder.embed(fact.factText));
    const blob = LocalEmbedder.vectorToBlob(vec);

    this.db
      .prepare(
        `INSERT INTO session_facts (id, session_id, fact_text, entities_json, reference_date_utc, embedding)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, fact.sessionId, fact.factText, fact.entitiesJson, fact.referenceDateUtc, blob);

    return id;
  }

  public async saveBatchMessages(
    messages: Array<Omit<MemoryMessage, 'id'> & { id?: string }>
  ): Promise<void> {
    const insertStmt = this.db.prepare(
      `INSERT INTO messages (id, session_id, role, content, created_at_utc, embedding)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const preparedData: Array<{
      id: string;
      sessionId: string;
      role: string;
      content: string;
      createdAtUtc: string;
      blob: Buffer;
    }> = [];

    for (const msg of messages) {
      const id = msg.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const vec = msg.embedding || (await LocalEmbedder.embed(msg.content));
      const blob = LocalEmbedder.vectorToBlob(vec);
      preparedData.push({
        id,
        sessionId: msg.sessionId,
        role: msg.role,
        content: msg.content,
        createdAtUtc: msg.createdAtUtc,
        blob,
      });
    }

    const tx = this.db.transaction((items: typeof preparedData) => {
      for (const item of items) {
        insertStmt.run(
          item.id,
          item.sessionId,
          item.role,
          item.content,
          item.createdAtUtc,
          item.blob
        );
      }
    });

    tx(preparedData);
  }

  // ==========================================
  // Private Helper Methods
  // ==========================================

  private formatHistoricalContext(
    messages: MemoryMessage[],
    facts: SessionFact[],
    temporalWindow?: TemporalWindow
  ): string {
    if (messages.length === 0 && facts.length === 0) {
      return '';
    }

    const lines: string[] = ['<historical_context>'];

    if (temporalWindow?.hasTemporalReference) {
      lines.push(
        `[TEMPORAL RESOLUTION: "${temporalWindow.rawExpression || ''}" -> UTC Window: ${
          temporalWindow.startUtc?.split('T')[0] || ''
        } (${temporalWindow.resolvedDaysAgo ?? 0} days ago)]`
      );
    }

    // Prioritize high-density atomic facts first (e.g., shortlists, pricing baselines)
    if (facts.length > 0) {
      lines.push('### DISTILLED ATOMIC FACTS (T0 BASELINE):');
      for (const fact of facts) {
        lines.push(`- [${fact.referenceDateUtc.split('T')[0]}] ${fact.factText}`);
      }
      lines.push('');
    }

    if (messages.length > 0) {
      lines.push('### RECALLED CONVERSATION TRANSCRIPT (T0):');
      for (const msg of messages) {
        const speaker = msg.role === 'user' ? 'User' : 'Assistant';
        // Truncate assistant historical responses to first 900 chars preserving T0 table/bullets
        const content =
          msg.role === 'assistant' && msg.content.length > 900
            ? `${msg.content.slice(0, 900)}... [T0 baseline truncated]`
            : msg.content;
        lines.push(`[${msg.createdAtUtc}] ${speaker}: ${content}`);
      }
    }

    lines.push('</historical_context>');
    let formatted = lines.join('\n');

    // Strict hard cap of 1,800 characters (~450 tokens)
    if (formatted.length > MAX_CONTEXT_CHARS) {
      formatted =
        formatted.substring(0, MAX_CONTEXT_CHARS - 32) +
        '\n... [TRUNCATED AT 450 TOKENS]\n</historical_context>';
    }

    return formatted;
  }
}

