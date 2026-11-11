import { createDataStreamResponse, type Message, type JSONValue } from 'ai';
import { z } from 'zod';
import { ChatOrchestrator } from '@/core/orchestrator/chat-orchestrator';
import { ensureDatabaseSeeded } from '@/core/memory/auto-seeder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    id: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system', 'data', 'tool']),
    content: z.string(),
    createdAt: z.unknown().optional(),
  }).passthrough()).default([]),
  sessionId: z.string().optional(),
});

export async function POST(req: Request) {
  // Cold-start self-healing: automatically seed if database is empty
  await ensureDatabaseSeeded();

  try {
    const rawBody: unknown = await req.json();
    const parseResult = ChatRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return new Response(
        JSON.stringify({
          error: 'Invalid request payload',
          details: parseResult.error.issues.map((i) => i.message).join('; '),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = parseResult.data;
    const messages = body.messages as Message[];
    const sessionId =
      body.sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const lastMessage = messages[messages.length - 1];
    const userPrompt = lastMessage?.role === 'user' ? lastMessage.content : '';

    if (!userPrompt.trim()) {
      return new Response(JSON.stringify({ error: 'User prompt is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const orchestrator = new ChatOrchestrator();

    return createDataStreamResponse({
      execute: async (dataStream) => {
        try {
          const { stream } = await orchestrator.executePipeline({
            sessionId,
            userPrompt,
            conversationHistory: messages.slice(0, -1).map((m) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
            })),
            onPhaseEvent: (event) => {
              dataStream.writeData({
                type: 'phase',
                ...event,
              } as unknown as JSONValue);
            },
            onTraceComplete: (trace) => {
              dataStream.writeData({
                type: 'trace_complete',
                trace,
              } as unknown as JSONValue);
            },
          });

          stream.mergeIntoDataStream(dataStream);
        } catch (err) {
          console.error('[API /api/chat] Pipeline execution error:', err);
          dataStream.writeData({
            type: 'phase',
            phase: 'response_synthesis',
            status: 'failed',
            detail: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          } as unknown as JSONValue);
          dataStream.writeData({
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          } as unknown as JSONValue);
        }
      },
      onError: (err) => {
        console.error('[API /api/chat] Stream-level error:', err);
        return err instanceof Error ? err.message : 'An unexpected error occurred during streaming.';
      },
    });
  } catch (err) {
    console.error('[API /api/chat] Request parse error:', err);
    return new Response(
      JSON.stringify({
        error: 'Invalid request payload',
        details: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
