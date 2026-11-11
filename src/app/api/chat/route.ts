import { createDataStreamResponse, type Message, type JSONValue } from 'ai';
import { ChatOrchestrator } from '@/core/orchestrator/chat-orchestrator';
import { ensureDatabaseSeeded } from '@/core/memory/auto-seeder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Cold-start self-healing: automatically seed if database is empty
  await ensureDatabaseSeeded();

  try {
    const body = (await req.json()) as {
      messages?: Message[];
      sessionId?: string;
    };

    const messages = body.messages || [];
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
