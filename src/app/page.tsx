'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { ChatViewport } from '@/components/chat-viewport';
import { XRayTraceDrawer } from '@/components/xray-trace-drawer';
import {
  Activity,
  Send,
  Sparkles,
  RefreshCw,
  Clock,
  ExternalLink,
} from 'lucide-react';
import type { PipelinePhaseEvent, TurnTracePayload } from '@/core/contracts/trace.contract';

const CHALLENGE_PROMPTS = [
  {
    id: 'monday_crm',
    label: 'Monday: 5 CRM Tools Pricing Delta',
    prompt:
      'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any changed pricing since?',
  },
  {
    id: 'tuesday_postgres',
    label: 'Last Tuesday: Postgres Hosting Plans',
    prompt:
      'Compare Postgres hosting providers from last Tuesday. Did Supabase or Neon update their plans?',
  },
  {
    id: 'nov3_vectordb',
    label: '3 November: Verifiable Baseline',
    prompt:
      'What did I ask you on 3 November? Is your answer still correct today?',
  },
];

export default function ChatPage() {
  const [sessionId] = useState<string>(() => `sess_${Date.now()}`);
  const [isXRayOpen, setIsXRayOpen] = useState(false);
  const [activeEvents, setActiveEvents] = useState<PipelinePhaseEvent[]>([]);
  const [latestTrace, setLatestTrace] = useState<TurnTracePayload | null>(null);
  const [allTraces, setAllTraces] = useState<TurnTracePayload[]>([]);
  const [isReseeding, setIsReseeding] = useState(false);
  const [reseedMessage, setReseedMessage] = useState<string | null>(null);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    data,
    append,
    setInput,
  } = useChat({
    api: '/api/chat',
    body: { sessionId },
    onResponse: () => {
      // Clear phase events for fresh turn
      setActiveEvents([]);
    },
  });

  // Parse custom stream data (pipeline phases and turn traces)
  useEffect(() => {
    if (data && data.length > 0) {
      const events: PipelinePhaseEvent[] = [];
      for (const item of data) {
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          if (obj.type === 'phase') {
            events.push(obj as unknown as PipelinePhaseEvent);
          } else if (obj.type === 'trace_complete' && obj.trace) {
            const trace = obj.trace as TurnTracePayload;
            setLatestTrace(trace);
            setAllTraces((prev) => {
              if (prev.some((t) => t.traceId === trace.traceId)) return prev;
              return [trace, ...prev];
            });
          }
        }
      }
      setActiveEvents(events);
    }
  }, [data]);

  const handleChipClick = (promptText: string) => {
    setInput(promptText);
    append({
      role: 'user',
      content: promptText,
    });
  };

  return (
    <div className="flex flex-col h-screen bg-[#090a0f] text-slate-100 overflow-hidden">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md px-4 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-600/30">
              M
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
                Minimi Temporal Agent
                <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                  SQLite Hybrid WAL
                </span>
              </h1>
            </div>
          </div>
        </div>

        {/* Action Controls in Header */}
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setIsReseeding(true);
              try {
                const res = await fetch('/api/traces', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'reseed' }),
                });
                if (res.ok) {
                  setReseedMessage('Database fixtures re-seeded!');
                  setTimeout(() => setReseedMessage(null), 3000);
                }
              } catch (err) {
                console.error('Failed to reseed:', err);
              } finally {
                setIsReseeding(false);
              }
            }}
            disabled={isReseeding}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/60 transition-all disabled:opacity-50"
            title="Reset and re-seed historical time-travel sessions"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isReseeding ? 'animate-spin' : ''}`} />
            <span>{reseedMessage || (isReseeding ? 'Seeding...' : 'Re-seed DB')}</span>
          </button>

          <button
            onClick={() => setIsXRayOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              isXRayOpen
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/20'
                : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/60'
            }`}
            title="Toggle X-Ray Observability Drawer"
          >
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            <span>X-Ray Trace</span>
            {latestTrace && (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">
                {latestTrace.latencies.totalMs}ms
              </span>
            )}
          </button>
        </div>
      </header>

      {/* One-Click Evaluator Challenge Prompts Bar */}
      <div className="border-b border-slate-800/60 bg-slate-900/40 px-4 py-2 flex items-center gap-2 overflow-x-auto text-xs flex-shrink-0">
        <div className="flex items-center gap-1.5 text-slate-400 flex-shrink-0 mr-1 font-medium">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Evaluator Prompts:</span>
        </div>
        <div className="flex items-center gap-2 flex-nowrap">
          {CHALLENGE_PROMPTS.map((challenge) => (
            <button
              key={challenge.id}
              onClick={() => handleChipClick(challenge.prompt)}
              disabled={isLoading}
              className="px-3 py-1 rounded-full bg-slate-800/60 hover:bg-indigo-950/60 hover:text-indigo-200 border border-slate-700/50 hover:border-indigo-700/60 text-slate-300 whitespace-nowrap transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              title={challenge.prompt}
            >
              {challenge.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat Scrollable Viewport */}
      <ChatViewport
        messages={messages}
        isLoading={isLoading}
        activeEvents={activeEvents}
        latestTrace={latestTrace}
        onOpenTrace={() => setIsXRayOpen(true)}
      />

      {/* Bottom Message Input Box */}
      <footer className="p-4 border-t border-slate-800/80 bg-slate-900/70 backdrop-blur-md flex-shrink-0">
        <form
          onSubmit={handleSubmit}
          className="max-w-4xl mx-auto flex items-center gap-2 relative"
        >
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Ask a temporal question (e.g. 'On Monday we shortlisted 5 CRM tools...')"
            disabled={isLoading}
            className="flex-1 bg-slate-950/90 border border-slate-800 text-slate-100 placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white disabled:text-slate-500 rounded-xl font-medium text-sm transition-all shadow-md shadow-indigo-600/20 active:scale-95 flex items-center justify-center flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[11px] text-center text-slate-500 mt-2 font-mono">
          Strict Single-Tool Mode (<code>web_search</code>) • Pre-Inference RRF Memory • Capped at 2.5k Tokens
        </p>
      </footer>

      {/* X-Ray Observability Drawer */}
      <XRayTraceDrawer
        isOpen={isXRayOpen}
        onClose={() => setIsXRayOpen(false)}
        trace={latestTrace}
        allTraces={allTraces}
        onSelectTrace={(trace) => setLatestTrace(trace)}
      />
    </div>
  );
}

