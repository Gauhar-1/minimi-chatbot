'use client';

import React from 'react';
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
} from 'lucide-react';
import type { TurnTracePayload } from '@/core/contracts/trace.contract';

interface XRayTraceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  trace: TurnTracePayload | null;
  allTraces?: TurnTracePayload[];
  onSelectTrace?: (trace: TurnTracePayload) => void;
}

export function XRayTraceDrawer({
  isOpen,
  onClose,
  trace,
  allTraces = [],
  onSelectTrace,
}: XRayTraceDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-slate-950/95 border-l border-slate-800 shadow-2xl backdrop-blur-md flex flex-col transition-all duration-300 ease-in-out">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800/80 bg-slate-900/50">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white tracking-wide">
            X-Ray Observability Trace
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

      {/* Trace Selector Dropdown (if multiple traces exist) */}
      {allTraces.length > 1 && (
        <div className="px-4 py-2 bg-slate-900/40 border-b border-slate-800/50 flex items-center justify-between text-xs">
          <span className="text-slate-400">Past Traces ({allTraces.length}):</span>
          <select
            className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500"
            value={trace?.traceId || ''}
            onChange={(e) => {
              const selected = allTraces.find((t) => t.traceId === e.target.value);
              if (selected && onSelectTrace) {
                onSelectTrace(selected);
              }
            }}
          >
            {allTraces.map((t, idx) => (
              <option key={t.traceId} value={t.traceId}>
                #{idx + 1} — {t.userPrompt.slice(0, 35)}... ({t.latencies?.totalMs || 0}ms)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs text-slate-300">
        {!trace ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-center space-y-2">
            <Clock className="w-8 h-8 opacity-40" />
            <p>No traces recorded yet.</p>
            <p className="text-[11px] max-w-xs">
              Execute a query to inspect live temporal bounds, episodic RRF recall, and parallel search telemetry.
            </p>
          </div>
        ) : (
          <>
            {/* User Prompt */}
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                Turn Prompt
              </span>
              <p className="text-slate-200 font-medium">{trace.userPrompt}</p>
            </div>

            {/* Latency Breakdown Metric Cards */}
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Pipeline Latency Breakdown
              </span>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block">Recall</span>
                  <span className="text-sm font-semibold font-mono text-emerald-400">
                    {trace.latencies.recallMs}ms
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block">Search</span>
                  <span className="text-sm font-semibold font-mono text-indigo-400">
                    {trace.latencies.searchFanoutMs}ms
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block">Scrape</span>
                  <span className="text-sm font-semibold font-mono text-cyan-400">
                    {trace.latencies.scrapeMs}ms
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block">Total</span>
                  <span className="text-sm font-semibold font-mono text-amber-400">
                    {trace.latencies.totalMs}ms
                  </span>
                </div>
              </div>
            </div>

            {/* Stage 1: Temporal Resolution Card */}
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Calendar className="w-4 h-4 text-indigo-400" />
                <span>Stage 1: Deterministic Temporal Resolution</span>
              </div>
              {trace.temporalResolution ? (
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div>
                    <span className="text-slate-500 block">Expression:</span>
                    <span className="font-mono text-indigo-300 font-medium">
                      "{trace.temporalResolution.raw}"
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Relative Offset:</span>
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
                  No temporal constraints detected. Defaulted to global recency.
                </p>
              )}
            </div>

            {/* Stage 2: Memory Recall Card */}
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span>Stage 2: Hybrid Episodic Memory (RRF)</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                    trace.memoryRecall?.status === 'MATCHED'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                      : trace.memoryRecall?.status === 'EMPTY_FOR_DATE_WINDOW'
                        ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                        : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {trace.memoryRecall?.status || 'UNKNOWN'}
                </span>
              </div>
              <div className="text-[11px] space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>RRF Matched Units:</span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {trace.memoryRecall?.rrfMatchedCount || 0}
                  </span>
                </div>
                {trace.memoryRecall?.matchedEntities && trace.memoryRecall.matchedEntities.length > 0 && (
                  <div className="pt-1">
                    <span className="text-slate-500 block mb-1">Recalled Baseline Facts:</span>
                    <ul className="space-y-1 pl-2 border-l border-emerald-800/40 text-[11px] text-slate-300">
                      {trace.memoryRecall.matchedEntities.map((ent, i) => (
                        <li key={i} className="line-clamp-2">
                          • {ent}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Stage 3: Search Fan-Out & Scraped URLs */}
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Search className="w-4 h-4 text-indigo-400" />
                <span>Stage 3: Parallel Fan-Out & Deep Scraping</span>
              </div>

              {trace.searchExecution?.queriesExecuted && trace.searchExecution.queriesExecuted.length > 0 ? (
                <div className="space-y-2 text-[11px]">
                  <div>
                    <span className="text-slate-500 block mb-1">
                      Executed Parallel Queries ({trace.searchExecution.queriesExecuted.length}):
                    </span>
                    <div className="space-y-1">
                      {trace.searchExecution.queriesExecuted.map((q, i) => (
                        <div
                          key={i}
                          className="px-2 py-1 rounded bg-slate-800/70 border border-slate-700/40 font-mono text-indigo-300"
                        >
                          "{q}"
                        </div>
                      ))}
                    </div>
                  </div>

                  {trace.searchExecution.urlsScraped && trace.searchExecution.urlsScraped.length > 0 && (
                    <div className="pt-1">
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
                  No web search was triggered for this turn.
                </p>
              )}
            </div>

            {/* Event Timeline */}
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Execution Timeline ({trace.events?.length || 0} events)
              </span>
              <div className="space-y-1.5 pl-2 border-l border-slate-800">
                {trace.events?.map((ev, i) => (
                  <div key={i} className="text-[11px] relative pl-3">
                    <div className="absolute -left-[13px] top-1 w-2 h-2 rounded-full bg-indigo-500" />
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-300 uppercase text-[10px]">
                        [{ev.phase}]
                      </span>
                      {ev.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      {ev.status === 'failed' && <AlertCircle className="w-3 h-3 text-rose-400" />}
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
      </div>
    </div>
  );
}

