'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Activity,
  Clock,
  Database,
  Search,
  FileText,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Archive,
  Layers,
} from 'lucide-react';
import type { TurnTracePayload } from '@/core/contracts/trace.contract';

interface XRayTraceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  trace: TurnTracePayload | null;
  allTraces?: TurnTracePayload[];
  onSelectTrace?: (trace: TurnTracePayload) => void;
}

interface HistoricalSessionData {
  sessionId: string;
  role: string;
  content: string;
  createdAtUtc: string;
}

interface SessionFactData {
  id: string;
  sessionId: string;
  factText: string;
  entitiesJson: string;
  referenceDateUtc: string;
}

export function XRayTraceDrawer({
  isOpen,
  onClose,
  trace,
  allTraces = [],
  onSelectTrace,
}: XRayTraceDrawerProps) {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'memory' | 'history'>('telemetry');
  const [historicalMessages, setHistoricalMessages] = useState<HistoricalSessionData[]>([]);
  const [historicalFacts, setHistoricalFacts] = useState<SessionFactData[]>([]);
  const [isReseeding, setIsReseeding] = useState(false);
  const [reseedStatus, setReseedStatus] = useState<string | null>(null);

  // Fetch seeded historical state when drawer opens or history tab is selected
  useEffect(() => {
    if (isOpen) {
      fetch('/api/traces')
        .then((res) => res.json())
        .then((data) => {
          if (data.recentMessages) setHistoricalMessages(data.recentMessages);
          if (data.sessionFacts) setHistoricalFacts(data.sessionFacts);
        })
        .catch((err) => console.warn('Failed to load trace browser data:', err));
    }
  }, [isOpen, activeTab]);

  const handleReseed = async () => {
    setIsReseeding(true);
    try {
      const res = await fetch('/api/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reseed' }),
      });
      if (res.ok) {
        setReseedStatus('Fixtures re-seeded successfully!');
        // Refresh history data
        const data = await fetch('/api/traces').then((r) => r.json());
        if (data.recentMessages) setHistoricalMessages(data.recentMessages);
        if (data.sessionFacts) setHistoricalFacts(data.sessionFacts);
        setTimeout(() => setReseedStatus(null), 3500);
      }
    } catch (err) {
      console.error('Failed to reseed:', err);
      setReseedStatus('Failed to reseed fixtures');
    } finally {
      setIsReseeding(false);
    }
  };

  if (!isOpen) return null;

  // Group historical messages by session
  const sessionGroups = historicalMessages.reduce(
    (acc, msg) => {
      if (!acc[msg.sessionId]) acc[msg.sessionId] = [];
      acc[msg.sessionId].push(msg);
      return acc;
    },
    {} as Record<string, HistoricalSessionData[]>
  );

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-slate-950/95 border-l border-slate-800 shadow-2xl backdrop-blur-md flex flex-col transition-all duration-300 ease-in-out">
      {/* Drawer Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800/80 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white tracking-wide">
            X-Ray Observability Inspector
          </h2>
          {trace && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">
              {trace.traceId}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Close Drawer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center border-b border-slate-800 bg-slate-900/40 px-4 text-xs font-medium">
        <button
          onClick={() => setActiveTab('telemetry')}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'telemetry'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Live Telemetry</span>
        </button>
        <button
          onClick={() => setActiveTab('memory')}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'memory'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Recalled Memory</span>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'history'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Archive className="w-3.5 h-3.5" />
          <span>Seeded History</span>
        </button>
      </div>

      {/* Drawer Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs text-slate-300">
        {/* =================================================================== */}
        {/* TAB 1: LIVE TURN TELEMETRY */}
        {/* =================================================================== */}
        {activeTab === 'telemetry' && (
          <>
            {allTraces.length > 1 && (
              <div className="flex items-center justify-between pb-1 border-b border-slate-800/60">
                <span className="text-slate-400">Select Past Turn:</span>
                <select
                  className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500 max-w-xs truncate"
                  value={trace?.traceId || ''}
                  onChange={(e) => {
                    const selected = allTraces.find((t) => t.traceId === e.target.value);
                    if (selected && onSelectTrace) onSelectTrace(selected);
                  }}
                >
                  {allTraces.map((t, idx) => (
                    <option key={t.traceId} value={t.traceId}>
                      #{idx + 1} — {t.userPrompt.slice(0, 30)}... ({t.latencies?.totalMs || 0}ms)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!trace ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-center space-y-2">
                <Clock className="w-8 h-8 opacity-40" />
                <p>No active trace recorded yet.</p>
                <p className="text-[11px] max-w-xs">
                  Ask a question to see real-time latency breakdowns, parallel search queries, and scraped URLs.
                </p>
              </div>
            ) : (
              <>
                {/* Prompt */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    Evaluated User Prompt
                  </span>
                  <p className="text-slate-200 font-medium leading-relaxed">{trace.userPrompt}</p>
                </div>

                {/* Latency Breakdown Cards */}
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                    Turn Latency Breakdown (ms)
                  </span>
                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800/80">
                      <span className="text-[9px] text-slate-400 block">Recall</span>
                      <span className="text-xs font-semibold font-mono text-emerald-400">
                        {trace.latencies.recallMs}ms
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800/80">
                      <span className="text-[9px] text-slate-400 block">Search</span>
                      <span className="text-xs font-semibold font-mono text-indigo-400">
                        {trace.latencies.searchFanoutMs}ms
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800/80">
                      <span className="text-[9px] text-slate-400 block">Scrape</span>
                      <span className="text-xs font-semibold font-mono text-cyan-400">
                        {trace.latencies.scrapeMs}ms
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800/80">
                      <span className="text-[9px] text-slate-400 block">TTFT</span>
                      <span className="text-xs font-semibold font-mono text-purple-400">
                        {trace.latencies.ttftMs ? `${trace.latencies.ttftMs}ms` : '—'}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800/80">
                      <span className="text-[9px] text-slate-400 block">Total</span>
                      <span className="text-xs font-semibold font-mono text-amber-400">
                        {trace.latencies.totalMs}ms
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stage 1: Temporal Resolution Card */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <Calendar className="w-4 h-4 text-indigo-400" />
                    <span>Stage 1: Deterministic Temporal Grounding</span>
                  </div>
                  {trace.temporalResolution ? (
                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                      <div>
                        <span className="text-slate-500 block">Parsed Expression:</span>
                        <span className="font-mono text-indigo-300 font-medium">
                          "{trace.temporalResolution.raw}"
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Relative Anchor:</span>
                        <span className="font-mono text-slate-200">
                          {trace.temporalResolution.resolvedDaysAgo} days ago
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block">UTC Window Bounds:</span>
                        <span className="font-mono text-emerald-400 text-[10px] break-all">
                          [{trace.temporalResolution.startUtc} ➔ {trace.temporalResolution.endUtc}]
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-400 text-[11px] italic">
                      No explicit temporal bounds parsed.
                    </p>
                  )}
                </div>

                {/* Stage 3: Search Fan-Out & Scraped URLs */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                      <Search className="w-4 h-4 text-indigo-400" />
                      <span>Stage 3: Parallel Fan-Out ({trace.searchExecution?.queriesExecuted?.length || 0} queries)</span>
                    </div>
                  </div>

                  {trace.searchExecution?.queriesExecuted && trace.searchExecution.queriesExecuted.length > 0 ? (
                    <div className="space-y-2 text-[11px]">
                      <div className="space-y-1">
                        {trace.searchExecution.queriesExecuted.map((q, i) => (
                          <div
                            key={i}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50 font-mono text-indigo-300"
                          >
                            • "{q}"
                          </div>
                        ))}
                      </div>

                      {trace.searchExecution.urlsScraped && trace.searchExecution.urlsScraped.length > 0 && (
                        <div className="pt-2">
                          <span className="text-slate-500 block mb-1">
                            Deep-Scraped URLs ({trace.searchExecution.urlsScraped.length}):
                          </span>
                          <div className="space-y-1">
                            {trace.searchExecution.urlsScraped.map((u, i) => (
                              <a
                                key={i}
                                href={u}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between px-2 py-1 rounded bg-slate-800/50 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors truncate"
                              >
                                <span className="truncate">{u}</span>
                                <ExternalLink className="w-3 h-3 ml-1 flex-shrink-0 opacity-70" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-[11px] italic">
                      No live web searches executed for this turn.
                    </p>
                  )}
                </div>

                {/* Timeline */}
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                    Execution Telemetry Timeline ({trace.events?.length || 0} events)
                  </span>
                  <div className="space-y-1.5 pl-2 border-l border-slate-800">
                    {trace.events?.map((ev, i) => (
                      <div key={i} className="text-[11px] relative pl-3">
                        <div className="absolute -left-[13px] top-1 w-2 h-2 rounded-full bg-indigo-500" />
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-300 uppercase text-[10px]">
                            [{ev.phase}]
                          </span>
                          {ev.status === 'completed' && (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          )}
                          {ev.status === 'failed' && (
                            <AlertCircle className="w-3 h-3 text-rose-400" />
                          )}
                          {ev.durationMs !== undefined && (
                            <span className="text-[10px] font-mono text-slate-500">
                              +{ev.durationMs}ms
                            </span>
                          )}
                        </div>
                        <p className="text-slate-400 mt-0.5">{ev.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* =================================================================== */}
        {/* TAB 2: RECALLED MEMORY (<historical_context>) */}
        {/* =================================================================== */}
        {activeTab === 'memory' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                Recall Status
              </span>
              <div className="flex items-center justify-between">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                    trace?.memoryRecall?.status === 'MATCHED'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                      : trace?.memoryRecall?.status === 'EMPTY_FOR_DATE_WINDOW'
                        ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                        : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {trace?.memoryRecall?.status || 'NO CONSTRAINTS'}
                </span>
                <span className="font-mono text-slate-400 text-xs">
                  Latency: {trace?.memoryRecall?.latencyMs || 0}ms
                </span>
              </div>
            </div>

            {trace?.memoryRecall?.matchedEntities && trace.memoryRecall.matchedEntities.length > 0 ? (
              <div className="space-y-2">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  RRF-Matched Atomic Facts (T0 Baseline):
                </span>
                <div className="space-y-2">
                  {trace.memoryRecall.matchedEntities.map((fact, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] leading-relaxed text-slate-200"
                    >
                      {fact}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-slate-500">
                <Layers className="w-8 h-8 opacity-40 mx-auto mb-2" />
                <p>No historical memory items matched this prompt.</p>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: SEEDED HISTORY BROWSER & RESET */}
        {/* =================================================================== */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white block">Time-Travel Fixtures</span>
                <span className="text-[11px] text-slate-400">
                  {Object.keys(sessionGroups).length} seeded sessions in SQLite WAL
                </span>
              </div>
              <button
                onClick={handleReseed}
                disabled={isReseeding}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isReseeding ? 'animate-spin' : ''}`} />
                <span>{isReseeding ? 'Seeding...' : 'Reset & Re-Seed'}</span>
              </button>
            </div>

            {reseedStatus && (
              <div className="p-2 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs text-center font-medium">
                {reseedStatus}
              </div>
            )}

            {/* List of Seeded Sessions */}
            <div className="space-y-3">
              {Object.entries(sessionGroups).map(([sessId, msgs]) => {
                const userMsg = msgs.find((m) => m.role === 'user');
                const assistantMsg = msgs.find((m) => m.role === 'assistant');
                const sessionDate = userMsg?.createdAtUtc?.split('T')[0] || '';

                return (
                  <div
                    key={sessId}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                      <span className="font-mono text-indigo-400 font-semibold text-[11px]">
                        {sessId}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {sessionDate}
                      </span>
                    </div>

                    {userMsg && (
                      <div>
                        <span className="text-[10px] font-semibold text-slate-500 block uppercase">
                          User (T0):
                        </span>
                        <p className="text-slate-300 text-[11px] line-clamp-2">
                          {userMsg.content}
                        </p>
                      </div>
                    )}

                    {assistantMsg && (
                      <div>
                        <span className="text-[10px] font-semibold text-slate-500 block uppercase">
                          Assistant Baseline (T0):
                        </span>
                        <p className="text-slate-400 text-[11px] line-clamp-3">
                          {assistantMsg.content}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
