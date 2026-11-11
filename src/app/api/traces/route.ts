import { NextResponse } from 'next/server';
import { SQLiteTraceLogger } from '@/core/orchestrator/trace-logger';
import { getDatabase, resetDatabase } from '@/core/memory/sqlite-client';
import { ensureDatabaseSeeded } from '@/core/memory/auto-seeder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  await ensureDatabaseSeeded();

  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId') || undefined;
  const traceId = url.searchParams.get('traceId') || undefined;
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);

  const logger = new SQLiteTraceLogger();

  if (traceId) {
    const trace = await logger.getTraceById(traceId);
    if (!trace) {
      return NextResponse.json({ error: 'Trace not found' }, { status: 404 });
    }
    return NextResponse.json({ trace });
  }

  const traces = await logger.getTraces(sessionId, limit);

  // Retrieve recent historical messages and facts from SQLite
  const db = getDatabase();
  const recentMessages = db
    .prepare(
      `SELECT session_id, role, content, created_at_utc
       FROM messages
       ORDER BY created_at_utc DESC
       LIMIT 50`
    )
    .all() as Array<{
      session_id: string;
      role: string;
      content: string;
      created_at_utc: string;
    }>;

  const sessionFacts = db
    .prepare(
      `SELECT id, session_id, fact_text, entities_json, reference_date_utc
       FROM session_facts
       ORDER BY reference_date_utc DESC
       LIMIT 50`
    )
    .all() as Array<{
      id: string;
      session_id: string;
      fact_text: string;
      entities_json: string;
      reference_date_utc: string;
    }>;

  const totalTracesCount = (
    db.prepare(`SELECT COUNT(*) as count FROM turn_traces`).get() as { count: number }
  ).count;
  const totalMessagesCount = (
    db.prepare(`SELECT COUNT(*) as count FROM messages`).get() as { count: number }
  ).count;
  const totalFactsCount = (
    db.prepare(`SELECT COUNT(*) as count FROM session_facts`).get() as { count: number }
  ).count;

  return NextResponse.json({
    traces,
    recentMessages,
    sessionFacts,
    stats: {
      totalTraces: totalTracesCount,
      totalMessages: totalMessagesCount,
      totalFacts: totalFactsCount,
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: 'reseed' | 'clear';
    };

    const action = body.action || 'reseed';

    if (action === 'reseed') {
      const result = await ensureDatabaseSeeded(true);
      return NextResponse.json({
        success: true,
        action: 'reseed',
        message: 'Successfully re-seeded historical sessions anchored to clock.',
        stats: {
          totalMessages: result.messageCount,
          totalFacts: result.factCount,
          sessions: result.sessionsSeeded,
          referenceDates: result.referenceDates,
        },
      });
    }

    if (action === 'clear') {
      resetDatabase();
      return NextResponse.json({
        success: true,
        action: 'clear',
        message: 'Successfully cleared all messages, facts, and traces from SQLite.',
        stats: {
          totalMessages: 0,
          totalFacts: 0,
          totalTraces: 0,
        },
      });
    }

    return NextResponse.json(
      { error: `Unsupported action "${action}". Must be "reseed" or "clear".` },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to process trace maintenance action',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
