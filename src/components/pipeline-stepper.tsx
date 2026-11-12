'use client';

import React, { memo } from 'react';
import {
  Calendar,
  Database,
  Search,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Hourglass,
} from 'lucide-react';
import type { PipelinePhaseEvent } from '@/core/contracts/trace.contract';

interface PipelineStepperProps {
  events: PipelinePhaseEvent[];
  isStreaming?: boolean;
  devMode?: boolean;
}

function PipelineStepperComponent({
  events,
  isStreaming,
  devMode = false,
}: PipelineStepperProps) {
  if (!events || events.length === 0) {
    if (!isStreaming) return null;
    return (
      <div className="inline-flex items-center gap-2 py-1.5 px-3 rounded-full bg-zinc-900/70 border border-white/[0.08] text-xs text-zinc-400 backdrop-blur-sm animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-ping" />
        <span>Thinking...</span>
      </div>
    );
  }

  // Active or latest completed event
  const latestEvent = events[events.length - 1];

  // =========================================================================
  // USER MODE (devMode === false): Calm, single-pill morphing status indicator
  // =========================================================================
  if (!devMode) {
    // Human micro-copy mapping
    let humanCopy = 'Working on your answer...';
    if (latestEvent.phase === 'temporal_parse' || latestEvent.phase === 'memory_recall') {
      humanCopy = 'Checking our past conversation...';
    } else if (latestEvent.phase === 'search_fanout') {
      humanCopy = 'Searching the web for recent updates...';
    } else if (latestEvent.phase === 'deep_scrape') {
      humanCopy = 'Reading live pricing & changelog pages...';
    } else if (latestEvent.phase === 'tpm_pacing' || latestEvent.phase === 'response_synthesis') {
      humanCopy = 'Synthesizing comparison...';
    }

    if (!isStreaming) {
      const searchEvents = events.filter((e) => e.phase === 'search_fanout' || e.phase === 'deep_scrape');
      return (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-medium my-1">
          <CheckCircle2 className="w-3 h-3 text-zinc-400" />
          <span>
            {searchEvents.length > 0 ? 'Verified across live sources' : 'Answered from conversation context'}
          </span>
        </div>
      );
    }

    return (
      <div className="inline-flex items-center gap-2 py-1.5 px-3 rounded-full bg-zinc-900/80 border border-white/[0.08] text-xs text-zinc-300 shadow-sm backdrop-blur-md transition-all duration-300">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
        </span>
        <span className="font-medium tracking-tight">{humanCopy}</span>
      </div>
    );
  }

  // =========================================================================
  // DEV MODE (devMode === true): Full 4-stage technical Telemetry Stepper
  // =========================================================================
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
    ...(events.some((e) => e.phase === 'tpm_pacing')
      ? [
          {
            id: 'tpm_pacing',
            label: 'TPM Pacing (Groq 8k)',
            icon: Hourglass,
            event: events.filter((e) => e.phase === 'tpm_pacing').slice(-1)[0],
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-2.5 my-2 p-3 bg-[#121215]/90 border border-white/[0.08] rounded-xl shadow-md text-xs backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        {stages.map((stage) => {
          const Icon = stage.icon;
          const ev = stage.event;
          const isStarted = ev?.status === 'started';
          const isCompleted = ev?.status === 'completed';
          const isFailed = ev?.status === 'failed';

          let containerClass = 'bg-zinc-900/60 text-zinc-500 border-white/[0.05]';
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
                <span className="text-[10px] font-mono tabular-nums opacity-80 ml-0.5">
                  {ev.durationMs}ms
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Live status detail line in Dev Mode */}
      {latestEvent && (
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-300 border-t border-white/[0.06] pt-2 px-0.5">
          <span className="text-indigo-400 font-semibold uppercase text-[10px]">
            [{latestEvent.phase}]
          </span>
          <span className="truncate">{latestEvent.detail}</span>
          {latestEvent.durationMs !== undefined && (
            <span className="text-zinc-500 ml-auto flex-shrink-0 tabular-nums">
              ({latestEvent.durationMs}ms)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const PipelineStepper = memo(PipelineStepperComponent);
