'use client';

import React from 'react';
import {
  Calendar,
  Database,
  Search,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { PipelinePhaseEvent } from '@/core/contracts/trace.contract';

interface PipelineStepperProps {
  events: PipelinePhaseEvent[];
  isStreaming?: boolean;
}

export function PipelineStepper({ events, isStreaming }: PipelineStepperProps) {
  if (!events || events.length === 0) {
    if (!isStreaming) return null;
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-400 animate-pulse">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        <span>Initializing temporal pipeline...</span>
      </div>
    );
  }

  // Get latest status for each phase
  const phases = [
    {
      id: 'temporal_parse',
      label: 'Temporal Grounding',
      icon: Calendar,
      event: events.filter((e) => e.phase === 'temporal_parse').slice(-1)[0],
    },
    {
      id: 'memory_recall',
      label: 'Episodic Recall',
      icon: Database,
      event: events.filter((e) => e.phase === 'memory_recall').slice(-1)[0],
    },
    {
      id: 'search_fanout',
      label: 'Search Fan-Out',
      icon: Search,
      event: events.filter((e) => e.phase === 'search_fanout').slice(-1)[0],
    },
    {
      id: 'deep_scrape',
      label: 'Deep Scraper',
      icon: FileText,
      event: events.filter((e) => e.phase === 'deep_scrape').slice(-1)[0],
    },
  ];

  return (
    <div className="flex flex-col gap-2 my-2 p-3 bg-slate-900/70 border border-slate-800/80 rounded-xl shadow-sm text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {phases.map((p) => {
          const Icon = p.icon;
          const ev = p.event;
          const isStarted = ev?.status === 'started';
          const isCompleted = ev?.status === 'completed';
          const isFailed = ev?.status === 'failed';

          let statusBadgeClass =
            'bg-slate-800/40 text-slate-500 border-slate-800';
          if (isStarted) {
            statusBadgeClass =
              'bg-indigo-950/70 text-indigo-300 border-indigo-700/60 animate-pulse';
          } else if (isCompleted) {
            statusBadgeClass =
              'bg-emerald-950/60 text-emerald-300 border-emerald-700/50';
          } else if (isFailed) {
            statusBadgeClass =
              'bg-rose-950/60 text-rose-300 border-rose-700/50';
          }

          return (
            <div
              key={p.id}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${statusBadgeClass}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="font-medium">{p.label}</span>
              {isStarted && <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />}
              {isCompleted && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
              {isFailed && <AlertCircle className="w-3 h-3 text-rose-400" />}
              {ev?.durationMs !== undefined && (
                <span className="text-[10px] opacity-75 font-mono ml-0.5">
                  {ev.durationMs}ms
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Latest live event detail */}
      {events.length > 0 && (
        <div className="text-[11px] text-slate-400 font-mono truncate pl-1 pt-0.5 border-t border-slate-800/50 flex items-center justify-between">
          <span className="truncate">
            <span className="text-slate-500 font-semibold uppercase mr-1.5">
              [{events[events.length - 1].phase}]
            </span>
            {events[events.length - 1].detail}
          </span>
        </div>
      )}
    </div>
  );
}

