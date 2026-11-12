import type Database from 'better-sqlite3';
import { getDatabase } from '@/core/memory/sqlite-client';
import type { ITraceLogger, TurnTracePayload } from '@/core/contracts/trace.contract';

export class SQLiteTraceLogger implements ITraceLogger {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  public async logTrace(trace: TurnTracePayload): Promise<void> {
    const traceJson = JSON.stringify(trace);
    const userId = (trace as any).userId || 'usr_evaluator';
    this.db
      .prepare(
        `INSERT INTO turn_traces (id, user_id, session_id, user_prompt, trace_json, created_at_utc)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        trace.traceId,
        userId,
        trace.sessionId,
        trace.userPrompt,
        traceJson,
        trace.timestampUtc
      );
  }

  public async getTraces(
    sessionId?: string,
    limit = 20,
    userId = 'usr_evaluator'
  ): Promise<TurnTracePayload[]> {
    let rows: Array<{ trace_json: string }>;
    if (sessionId) {
      rows = this.db
        .prepare(
          `SELECT trace_json FROM turn_traces
           WHERE user_id = ? AND session_id = ?
           ORDER BY created_at_utc DESC
           LIMIT ?`
        )
        .all(userId, sessionId, limit) as Array<{ trace_json: string }>;
    } else {
      rows = this.db
        .prepare(
          `SELECT trace_json FROM turn_traces
           WHERE user_id = ?
           ORDER BY created_at_utc DESC
           LIMIT ?`
        )
        .all(userId, limit) as Array<{ trace_json: string }>;
    }

    return rows
      .map((r) => {
        try {
          return JSON.parse(r.trace_json) as TurnTracePayload;
        } catch {
          return null;
        }
      })
      .filter((t): t is TurnTracePayload => t !== null);
  }

  public async getTraceById(traceId: string, userId = 'usr_evaluator'): Promise<TurnTracePayload | null> {
    const row = this.db
      .prepare(`SELECT trace_json FROM turn_traces WHERE id = ? AND user_id = ?`)
      .get(traceId, userId) as { trace_json: string } | undefined;

    if (!row) return null;
    try {
      return JSON.parse(row.trace_json) as TurnTracePayload;
    } catch {
      return null;
    }
  }
}

