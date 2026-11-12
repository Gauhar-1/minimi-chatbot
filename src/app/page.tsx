'use client';

import React, { useState, useEffect, useId, useRef, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  ChatViewport,
  MINIMI_CHALLENGE_PROMPTS,
} from '@/components/chat-viewport';
import { ChatComposer } from '@/components/chat-composer';
import { ChatSidebar, type SessionItem } from '@/components/chat-sidebar';
import { XRayTraceDrawer } from '@/components/xray-trace-drawer';
import {
  Activity,
  Sparkles,
  RefreshCw,
  Cpu,
  Plus,
  Terminal,
  PanelLeft,
} from 'lucide-react';
import type { PipelinePhaseEvent, TurnTracePayload } from '@/core/contracts/trace.contract';

export default function ChatPage() {
  const reactId = useId();
  const [activeUserId, setActiveUserId] = useState<string>('usr_evaluator');
  const [sessionId, setSessionId] = useState<string>(() => `sess_${reactId.replace(/:/g, '_')}`);
  const [devMode, setDevMode] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [isXRayOpen, setIsXRayOpen] = useState(false);
  const [activeEvents, setActiveEvents] = useState<PipelinePhaseEvent[]>([]);
  const [latestTrace, setLatestTrace] = useState<TurnTracePayload | null>(null);
  const [allTraces, setAllTraces] = useState<TurnTracePayload[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [isReseeding, setIsReseeding] = useState(false);
  const [reseedMessage, setReseedMessage] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  // Track the number of processed data items to prevent redundant re-renders
  const processedDataLengthRef = useRef<number>(0);
  const prevEventsSigRef = useRef<string>('');

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

  // Fetch session history for active user
  const fetchSessions = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/sessions?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.warn('Failed to fetch user sessions:', err);
    }
  }, []);

  useEffect(() => {
    fetchSessions(activeUserId);
  }, [activeUserId, fetchSessions]);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    data,
    append,
    reload,
    stop,
    setMessages,
  } = useChat({
    id: sessionId,
    api: '/api/chat',
    body: { sessionId, userId: activeUserId },
    onResponse: () => {
      setActiveEvents([]);
      setChatError(null);
      processedDataLengthRef.current = 0;
      prevEventsSigRef.current = '';
      fetchSessions(activeUserId);
    },
    onFinish: () => {
      fetchSessions(activeUserId);
    },
    onError: (err) => {
      console.error('[useChat] Error caught:', err);
      setChatError(err.message || 'Failed to complete turn verification.');
    },
  });

  // Handle New Chat reset (with stream stop)
  const handleNewChat = useCallback(() => {
    stop();
    const freshId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setSessionId(freshId);
    setMessages([]);
    setActiveEvents([]);
    setLatestTrace(null);
    setChatError(null);
    processedDataLengthRef.current = 0;
    prevEventsSigRef.current = '';
  }, [stop, setMessages]);

  // Keyboard shortcut: Cmd+K / Ctrl+K for New Chat
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handleNewChat();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewChat]);

  // Load an existing session's transcript from the database
  const handleSelectSession = async (targetSessionId: string) => {
    if (targetSessionId === sessionId) return;
    stop();
    setSessionId(targetSessionId);
    setActiveEvents([]);
    setLatestTrace(null);
    setChatError(null);
    processedDataLengthRef.current = 0;
    prevEventsSigRef.current = '';

    try {
      const res = await fetch(
        `/api/sessions?userId=${encodeURIComponent(activeUserId)}&sessionId=${encodeURIComponent(targetSessionId)}`
      );
      if (res.ok) {
        const data = await res.json();
        const loadedMessages = (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: new Date(m.created_at_utc),
        }));
        setMessages(loadedMessages);
      }
    } catch (err) {
      console.error('Failed to load session messages:', err);
    }
  };

  // Delete a session
  const handleDeleteSession = async (targetSessionId: string) => {
    try {
      const res = await fetch(
        `/api/sessions?userId=${encodeURIComponent(activeUserId)}&sessionId=${encodeURIComponent(targetSessionId)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== targetSessionId));
        if (targetSessionId === sessionId) {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  // Switch Workspace / User ID (Multi-Tenant Isolation Proof)
  const handleChangeUserId = (newUserId: string) => {
    if (newUserId === activeUserId) return;
    stop();
    setActiveUserId(newUserId);
    const freshId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setSessionId(freshId);
    setMessages([]);
    setActiveEvents([]);
    setLatestTrace(null);
    setChatError(null);
    fetchSessions(newUserId);
  };

  // Parse custom stream data (pipeline phases and turn traces)
  useEffect(() => {
    if (!data || data.length === 0) {
      if (processedDataLengthRef.current > 0) {
        processedDataLengthRef.current = 0;
        prevEventsSigRef.current = '';
        setActiveEvents([]);
      }
      return;
    }

    if (data.length === processedDataLengthRef.current) {
      return;
    }
    processedDataLengthRef.current = data.length;

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

    const currentSig = events.map((e) => `${e.phase}:${e.status}:${e.durationMs ?? 0}`).join('|');
    if (currentSig !== prevEventsSigRef.current) {
      prevEventsSigRef.current = currentSig;
      setActiveEvents(events);
    }

    if (foundTrace) {
      const trace = foundTrace;
      setLatestTrace((prev) => (prev?.traceId === trace.traceId ? prev : trace));
      setAllTraces((prev) => {
        if (prev.some((t) => t.traceId === trace.traceId)) return prev;
        return [trace, ...prev];
      });
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
        await fetchSessions(activeUserId);
        setTimeout(() => setReseedMessage(null), 3000);
      }
    } catch (err) {
      console.error('Failed to reseed:', err);
    } finally {
      setIsReseeding(false);
    }
  };

  const activeLatencyBadge = latestTrace
    ? `${(latestTrace.latencies.recallMs || 0) + (latestTrace.latencies.searchFanoutMs || 0)}ms`
    : null;

  return (
    <div className="flex h-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden font-sans">
      {/* Collapsible Left History Sidebar */}
      <ChatSidebar
        sessions={sessions}
        activeSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        isOpen={isSidebarOpen}
        onToggleOpen={() => setIsSidebarOpen((prev) => !prev)}
        devMode={devMode}
        activeUserId={activeUserId}
        onChangeUserId={handleChangeUserId}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Sleek Minimal Header */}
        <header className="h-14 border-b border-white/[0.07] backdrop-blur-md bg-zinc-950/80 px-4 flex items-center justify-between flex-shrink-0 z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent hover:border-white/[0.08] transition-colors"
              title="Toggle sidebar"
            >
              <PanelLeft className="w-4 h-4" />
            </button>

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
                <span className="hidden md:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-mono bg-zinc-900 text-zinc-400 border border-white/[0.06]">
                  <Cpu className="w-3 h-3 text-indigo-400" />
                  gpt-oss-20b · SQLite FTS5+Vec
                </span>

                <button
                  onClick={handleReseed}
                  disabled={isReseeding}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-white/[0.08] transition-colors disabled:opacity-50"
                  title="Reset and re-seed historical time-travel sessions"
                >
                  <RefreshCw className={`w-3 h-3 text-emerald-400 ${isReseeding ? 'animate-spin' : ''}`} />
                  <span>{reseedMessage || (isReseeding ? 'Seeding...' : 'Re-Seed')}</span>
                </button>

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

        {/* Dev Mode Evaluator Prompts Bar (visible only in Dev Mode above chat) */}
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

        {/* Auto-Expanding Dynamic Composer */}
        <footer className="p-4 border-t border-white/[0.07] bg-zinc-950/70 backdrop-blur-md flex-shrink-0">
          <ChatComposer
            input={input}
            onInputChange={handleInputChange}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            onStop={stop}
            placeholder="Ask anything or explore past conversations..."
          />
          {devMode && (
            <p className="text-[11px] text-center text-zinc-500 mt-2 font-mono">
              Dev Mode Active • User: <span className="text-indigo-400">{activeUserId}</span> • openai/gpt-oss-20b • Hybrid RRF Recall &lt;450 Tokens
            </p>
          )}
        </footer>
      </div>

      {/* X-Ray Observability Drawer */}
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
