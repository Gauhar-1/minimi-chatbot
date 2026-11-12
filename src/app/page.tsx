'use client';

import React, { useState, useEffect, useId } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  ChatViewport,
  MINIMI_CHALLENGE_PROMPTS,
} from '@/components/chat-viewport';
import { XRayTraceDrawer } from '@/components/xray-trace-drawer';
import {
  Activity,
  ArrowUp,
  Sparkles,
  RefreshCw,
  Cpu,
  Plus,
  Terminal,
} from 'lucide-react';
import type { PipelinePhaseEvent, TurnTracePayload } from '@/core/contracts/trace.contract';

export default function ChatPage() {
  const reactId = useId();
  const [sessionId, setSessionId] = useState<string>(() => `sess_${reactId.replace(/:/g, '_')}`);
  const [devMode, setDevMode] = useState<boolean>(false);
  const [isXRayOpen, setIsXRayOpen] = useState(false);
  const [activeEvents, setActiveEvents] = useState<PipelinePhaseEvent[]>([]);
  const [latestTrace, setLatestTrace] = useState<TurnTracePayload | null>(null);
  const [allTraces, setAllTraces] = useState<TurnTracePayload[]>([]);
  const [isReseeding, setIsReseeding] = useState(false);
  const [reseedMessage, setReseedMessage] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  // Sync devMode with localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('minimi_dev_mode');
      if (saved !== null) {
        setDevMode(saved === 'true');
      }
    } catch {
      // Ignore if localStorage unavailable
    }
  }, []);

  const toggleDevMode = () => {
    setDevMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('minimi_dev_mode', String(next));
      } catch {
        // Ignore
      }
      return next;
    });
  };

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    data,
    append,
    reload,
    setMessages,
  } = useChat({
    api: '/api/chat',
    body: { sessionId },
    onResponse: () => {
      setActiveEvents([]);
      setChatError(null);
    },
    onError: (err) => {
      console.error('[useChat] Error caught:', err);
      // In dev mode, show technical message; in user mode, keep calm
      setChatError(err.message || 'Failed to complete turn verification.');
    },
  });

  // Handle New Chat reset
  const handleNewChat = () => {
    setSessionId(`sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    setMessages([]);
    setActiveEvents([]);
    setLatestTrace(null);
    setChatError(null);
  };

  // Parse custom stream data (pipeline phases and turn traces)
  useEffect(() => {
    if (data && data.length > 0) {
      const events: PipelinePhaseEvent[] = [];
      let foundTrace: TurnTracePayload | null = null;

      for (const item of data) {
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          if (obj.type === 'phase') {
            events.push(obj as unknown as PipelinePhaseEvent);
          } else if (obj.type === 'trace_complete' && obj.trace) {
            foundTrace = obj.trace as TurnTracePayload;
          }
        }
      }

      setActiveEvents(events);

      if (foundTrace) {
        const trace = foundTrace;
        setLatestTrace((prev) => (prev?.traceId === trace.traceId ? prev : trace));
        setAllTraces((prev) => {
          if (prev.some((t) => t.traceId === trace.traceId)) return prev;
          return [trace, ...prev];
        });
      }
    }
  }, [data]);

  const handleChipClick = (promptText: string) => {
    setChatError(null);
    append({
      role: 'user',
      content: promptText,
    });
  };

  const handleReseed = async () => {
    setIsReseeding(true);
    try {
      const res = await fetch('/api/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reseed' }),
      });
      if (res.ok) {
        setReseedMessage('Seeded!');
        setTimeout(() => setReseedMessage(null), 3000);
      }
    } catch (err) {
      console.error('Failed to reseed:', err);
    } finally {
      setIsReseeding(false);
    }
  };

  // Active turn search + recall latency metric for header
  const activeLatencyBadge = latestTrace
    ? `${(latestTrace.latencies.recallMs || 0) + (latestTrace.latencies.searchFanoutMs || 0)}ms`
    : null;

  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden font-sans">
      {/* Sleek Minimal Header */}
      <header className="h-14 border-b border-white/[0.07] backdrop-blur-md bg-zinc-950/80 px-4 flex items-center justify-between flex-shrink-0 z-10 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-sm tracking-tight text-white">Minimi</span>
          </div>

          <button
            onClick={handleNewChat}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.08] hover:border-white/[0.18] text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-900/40 hover:bg-zinc-900 transition-colors"
            title="Start a new chat session"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-2">
          {/* Conditional Dev Controls (Shown ONLY when devMode === true) */}
          {devMode && (
            <>
              {/* Architecture Badge */}
              <span className="hidden md:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-mono bg-zinc-900 text-zinc-400 border border-white/[0.06]">
                <Cpu className="w-3 h-3 text-indigo-400" />
                gpt-oss-20b · SQLite FTS5+Vec
              </span>

              {/* Re-seed Fixtures Button */}
              <button
                onClick={handleReseed}
                disabled={isReseeding}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-white/[0.08] transition-colors disabled:opacity-50"
                title="Reset and re-seed historical time-travel sessions"
              >
                <RefreshCw className={`w-3 h-3 text-emerald-400 ${isReseeding ? 'animate-spin' : ''}`} />
                <span>{reseedMessage || (isReseeding ? 'Seeding...' : 'Re-Seed')}</span>
              </button>

              {/* X-Ray Drawer Toggle */}
              <button
                onClick={() => setIsXRayOpen((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                  isXRayOpen
                    ? 'bg-zinc-800 text-white border-white/[0.2]'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-white/[0.08]'
                }`}
                title="Toggle X-Ray Observability Drawer"
              >
                <Activity className="w-3 h-3 text-indigo-400" />
                <span>X-Ray</span>
                {activeLatencyBadge && (
                  <span className="text-[10px] font-mono tabular-nums px-1 rounded bg-zinc-800 text-zinc-300 border border-white/[0.06]">
                    {activeLatencyBadge}
                  </span>
                )}
              </button>
            </>
          )}

          {/* Tactile Dev Mode Pill Switch */}
          <button
            onClick={toggleDevMode}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all ${
              devMode
                ? 'bg-indigo-950/70 text-indigo-300 border-indigo-700/60 shadow-sm'
                : 'bg-zinc-900 hover:bg-zinc-800/80 text-zinc-400 border-white/[0.08]'
            }`}
            title="Toggle X-Ray Telemetry & Memory Inspector"
          >
            <Terminal className="w-3 h-3" />
            <span>Dev Mode</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                devMode ? 'bg-indigo-400' : 'bg-zinc-600'
              }`}
            />
          </button>
        </div>
      </header>

      {/* Dev Mode Challenge Prompts Bar (visible only in Dev Mode above chat) */}
      {devMode && (
        <div className="border-b border-white/[0.06] bg-zinc-950/40 px-4 py-2 flex items-center gap-2 overflow-x-auto text-xs flex-shrink-0 scrollbar-none">
          <div className="flex items-center gap-1.5 text-zinc-400 flex-shrink-0 mr-1 font-medium text-[11px]">
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Evaluator Prompts:</span>
          </div>
          <div className="flex items-center gap-2 flex-nowrap">
            {MINIMI_CHALLENGE_PROMPTS.map((challenge) => (
              <button
                key={challenge.id}
                onClick={() => handleChipClick(challenge.prompt)}
                disabled={isLoading}
                className="px-2.5 py-0.5 rounded-full border text-[11px] whitespace-nowrap transition-colors bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-white/[0.06] disabled:opacity-50"
                title={challenge.prompt}
              >
                {challenge.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dev Mode Error Notification */}
      {devMode && chatError && (
        <div className="bg-rose-950/60 border-b border-rose-800/60 px-4 py-2 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-wider text-[10px] bg-rose-900/80 px-1.5 py-0.5 rounded">
              Telemetry Error
            </span>
            <span className="font-mono">{chatError}</span>
          </div>
          <button
            onClick={() => setChatError(null)}
            className="text-rose-400 hover:text-rose-200 underline text-[11px] ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Chat Scrollable Viewport */}
      <ChatViewport
        messages={messages}
        isLoading={isLoading}
        activeEvents={activeEvents}
        latestTrace={latestTrace}
        devMode={devMode}
        onOpenTrace={() => setIsXRayOpen(true)}
        onSelectPrompt={handleChipClick}
        onRetryTurn={() => reload()}
      />

      {/* Floating Bottom Composer */}
      <footer className="p-4 border-t border-white/[0.07] bg-zinc-950/70 backdrop-blur-md flex-shrink-0">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto flex items-center gap-2 relative bg-[#121215] border border-white/[0.08] focus-within:border-white/[0.2] rounded-xl px-3 py-1.5 transition-all shadow-lg"
        >
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Ask anything or explore past conversations..."
            disabled={isLoading}
            className="flex-1 bg-transparent text-[#f4f4f5] placeholder-zinc-500 text-sm focus:outline-none py-1.5 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-8 h-8 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 font-medium text-sm transition-all flex items-center justify-center flex-shrink-0"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>
        {devMode && (
          <p className="text-[11px] text-center text-zinc-500 mt-2 font-mono">
            Dev Mode Active • openai/gpt-oss-20b • Hybrid RRF Recall &lt;450 Tokens • Capped at 2.2k Tool Budget
          </p>
        )}
      </footer>

      {/* X-Ray Observability Drawer (Available in Dev Mode) */}
      <XRayTraceDrawer
        isOpen={isXRayOpen && devMode}
        onClose={() => setIsXRayOpen(false)}
        trace={latestTrace}
        allTraces={allTraces}
        onSelectTrace={(trace) => setLatestTrace(trace)}
      />
    </div>
  );
}
