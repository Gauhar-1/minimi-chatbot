import { NextResponse } from 'next/server';
import { getDatabase } from '@/core/memory/sqlite-client';
import { ensureDatabaseSeeded } from '@/core/memory/auto-seeder';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateSessionSchema = z.object({
  id: z.string().optional(),
  userId: z.string().default('usr_evaluator'),
  title: z.string().optional(),
});

/**
 * GET /api/sessions?userId=...
 * If sessionId is also provided: returns full message transcript for that session.
 * Otherwise: returns all sessions for that user ordered by updated_at_utc DESC.
 */
export async function GET(req: Request) {
  await ensureDatabaseSeeded();

  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') || 'usr_evaluator';
  const sessionId = url.searchParams.get('sessionId') || undefined;

  const db = getDatabase();

  if (sessionId) {
    const session = db
      .prepare('SELECT id, user_id, title, created_at_utc, updated_at_utc FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as { id: string; user_id: string; title: string; created_at_utc: string; updated_at_utc: string } | undefined;

    const messages = db
      .prepare(
        `SELECT id, user_id, session_id, role, content, created_at_utc
         FROM messages
         WHERE session_id = ? AND user_id = ?
         ORDER BY created_at_utc ASC`
      )
      .all(sessionId, userId);

    return NextResponse.json({
      session: session || null,
      messages,
    });
  }

  // Get all sessions for this user
  const sessions = db
    .prepare(
      `SELECT id, user_id, title, created_at_utc, updated_at_utc
       FROM sessions
       WHERE user_id = ?
       ORDER BY updated_at_utc DESC`
    )
    .all(userId);

  return NextResponse.json({
    sessions,
  });
}

/**
 * POST /api/sessions
 * Creates a new session or auto-titles an existing session.
 */
export async function POST(req: Request) {
  await ensureDatabaseSeeded();

  try {
    const body = await req.json();
    const parsed = CreateSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid session payload' }, { status: 400 });
    }

    const { id, userId, title } = parsed.data;
    const nowUtc = new Date().toISOString();
    const sessionId = id || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sessionTitle = title || 'New Conversation';

    const db = getDatabase();
    db.prepare(
      `INSERT INTO sessions (id, user_id, title, created_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         updated_at_utc = excluded.updated_at_utc`
    ).run(sessionId, userId, sessionTitle, nowUtc, nowUtc);

    return NextResponse.json({
      id: sessionId,
      userId,
      title: sessionTitle,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    });
  } catch (err) {
    console.error('[API /api/sessions] POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create or update session' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sessions?sessionId=...&userId=...
 * Deletes a session and its associated messages, facts, and traces.
 */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  const userId = url.searchParams.get('userId') || 'usr_evaluator';

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId parameter is required' }, { status: 400 });
  }

  const db = getDatabase();

  const deleteTx = db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
    db.prepare('DELETE FROM messages WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
    db.prepare('DELETE FROM session_facts WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
    db.prepare('DELETE FROM turn_traces WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
  });

  try {
    deleteTx();
    return NextResponse.json({ success: true, deletedSessionId: sessionId });
  } catch (err) {
    console.error('[API /api/sessions] DELETE error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete session' },
      { status: 500 }
    );
  }
}

