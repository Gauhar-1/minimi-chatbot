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
      <div className="flex items-center gap-2 py-2 px-3 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-400 animate-pulse">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        <span>Initializing temporal grounding pipeline...</span>
      </div>
    );
  }

  const stages = [
    {
      id: 'temporal_parse',
      label: 'Temporal Parse',
      icon: Calendar,
      event: events.filter((e) => e.phase === 'temporal_parse').slice(-1)[0],
    },
    {
      id: 'memory_recall',
      label: 'Hybrid RRF Recall',
      icon: Database,
      event: events.filter((e) => e.phase === 'memory_recall').slice(-1)[0],
    },
    {
      id: 'search_fanout',
      label: 'Parallel Search Fan-Out',
      icon: Search,
      event: events.filter((e) => e.phase === 'search_fanout').slice(-1)[0],
    },
    {
      id: 'deep_scrape',
      label: 'Deep Pricing Scrape',
      icon: FileText,
      event: events.filter((e) => e.phase === 'deep_scrape').slice(-1)[0],
    },
  ];

  // Active or latest completed event
  const latestEvent = events[events.length - 1];

  return (
    <div className="flex flex-col gap-2.5 my-2 p-3 bg-slate-950/80 border border-slate-800/90 rounded-xl shadow-md text-xs backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        {stages.map((stage) => {
          const Icon = stage.icon;
          const ev = stage.event;
          const isStarted = ev?.status === 'started';
          const isCompleted = ev?.status === 'completed';
          const isFailed = ev?.status === 'failed';

          let containerClass = 'bg-slate-900/50 text-slate-500 border-slate-800/60';
          if (isStarted) {
            containerClass =
              'bg-indigo-950/80 text-indigo-300 border-indigo-700/60 shadow-sm shadow-indigo-950 animate-pulse';
          } else if (isCompleted) {
            containerClass =
              'bg-emerald-950/70 text-emerald-300 border-emerald-700/60';
          } else if (isFailed) {
            containerClass =
              'bg-rose-950/70 text-rose-300 border-rose-700/60';
          }

          return (
            <div
              key={stage.id}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all ${containerClass}`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{stage.label}</span>
              {isStarted && (
                <Loader2 className="w-3 h-3 animate-spin text-indigo-400 ml-0.5" />
              )}
              {isCompleted && (
                <CheckCircle2 className="w-3 h-3 text-emerald-400 ml-0.5" />
              )}
              {isFailed && (
                <AlertCircle className="w-3 h-3 text-rose-400 ml-0.5" />
              )}
              {ev?.durationMs !== undefined && (
                <span className="text-[10px] font-mono opacity-80 ml-0.5">
                  {ev.durationMs}ms
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Live status detail line */}
      {latestEvent && (
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300 border-t border-slate-800/60 pt-2 px-0.5">
          <span className="text-indigo-400 font-semibold uppercase text-[10px]">
            [{latestEvent.phase}]
          </span>
          <span className="truncate">{latestEvent.detail}</span>
          {latestEvent.durationMs !== undefined && (
            <span className="text-slate-500 ml-auto flex-shrink-0">
              ({latestEvent.durationMs}ms)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
