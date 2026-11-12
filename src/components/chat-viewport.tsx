'use client';

import React, { useEffect, useRef, useState, memo } from 'react';
import type { Message } from 'ai';
import { MarkdownRenderer } from './markdown-renderer';
import { PipelineStepper } from './pipeline-stepper';
import { User, Bot, Activity, Sparkles, ShieldAlert, ArrowDown } from 'lucide-react';
import type { PipelinePhaseEvent, TurnTracePayload } from '@/core/contracts/trace.contract';

export interface ChallengePrompt {
  id: string;
  label: string;
  prompt: string;
  isGuard?: boolean;
}

export const MINIMI_CHALLENGE_PROMPTS: ChallengePrompt[] = [
  {
    id: 'monday_crm',
    label: 'Monday: 5 CRM Tools Pricing Delta',
    prompt:
      'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
  },
  {
    id: 'nov3_vectordb',
    label: '3 November: Verifiable Baseline',
    prompt:
      'What did I ask you on 3 November? Is your answer still correct today?',
  },
  {
    id: 'tuesday_postgres',
    label: 'Last Tuesday: Postgres Hosting Plans',
    prompt:
      'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
  },
  {
    id: 'empty_guard',
    label: '19 August: Empty Recall Guard (Test)',
    prompt:
      'What did I ask you on 19 August? Is your answer still correct?',
    isGuard: true,
  },
];

interface ChatViewportProps {
  messages: Message[];
  isLoading: boolean;
  activeEvents: PipelinePhaseEvent[];
  latestTrace: TurnTracePayload | null;
  onOpenTrace: () => void;
  onSelectPrompt: (prompt: string) => void;
}

function ChatViewportComponent({
  messages,
  isLoading,
  activeEvents,
  latestTrace,
  onOpenTrace,
  onSelectPrompt,
}: ChatViewportProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  // Handle scroll detection
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    setIsUserScrolledUp(distanceToBottom > 120);
  };

  // Auto-scroll pinning to bottom during streaming unless user scrolled up
  useEffect(() => {
    if (!isUserScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages.length, (messages[messages.length - 1]?.content || '').length, activeEvents.length, isUserScrolledUp]);

  const scrollToBottom = () => {
    setIsUserScrolledUp(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400 max-w-3xl mx-auto w-full">
        <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/25 flex items-center justify-center mb-4 text-indigo-400 shadow-lg shadow-indigo-950/50">
          <Bot className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2 tracking-tight">
          Minimi Temporal Web-Search Agent
        </h2>
        <p className="text-xs max-w-lg text-slate-400 leading-relaxed mb-8">
          Pre-inference temporal reasoning via <code className="text-indigo-300 font-mono">chrono-node</code>,
          episodic memory with SQLite <code className="text-indigo-300 font-mono">FTS5</code> + local embeddings,
          and strictly single-tool agentic loop (<code className="text-indigo-300 font-mono">web_search</code>) with deep pricing table extraction.
        </p>

        {/* Challenge Prompts Grid on Empty State */}
        <div className="w-full text-left space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider pl-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Select a Minimi Challenge Test Prompt:</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {MINIMI_CHALLENGE_PROMPTS.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelectPrompt(p.prompt)}
                className={`p-3.5 rounded-xl border text-left transition-all duration-150 hover:shadow-lg active:scale-[0.99] group ${
                  p.isGuard
                    ? 'bg-amber-950/20 hover:bg-amber-950/40 border-amber-800/40 hover:border-amber-700/60'
                    : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800 hover:border-indigo-600/60'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`font-semibold text-xs ${
                      p.isGuard
                        ? 'text-amber-300 flex items-center gap-1'
                        : 'text-indigo-300 group-hover:text-indigo-200'
                    }`}
                  >
                    {p.isGuard && <ShieldAlert className="w-3 h-3 text-amber-400" />}
                    {p.label}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                  "{p.prompt}"
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl w-full mx-auto relative"
    >
      {messages.map((message, idx) => {
        const isUser = message.role === 'user';
        const isLastAssistant = !isUser && idx === messages.length - 1;

        return (
          <div
            key={message.id || idx}
            className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            {!isUser && (
              <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 text-indigo-400 mt-1 shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              className={`max-w-[88%] sm:max-w-[82%] rounded-2xl p-4 shadow-md ${
                isUser
                  ? 'bg-indigo-600 text-white rounded-tr-none font-medium text-sm'
                  : 'bg-slate-900/85 border border-slate-800 text-slate-200 rounded-tl-none'
              }`}
            >
              {/* Show live pipeline stepper during turn generation */}
              {isLastAssistant && isLoading && activeEvents.length > 0 && (
                <div className="mb-3">
                  <PipelineStepper events={activeEvents} isStreaming={isLoading} />
                </div>
              )}

              {/* Render message body */}
              {isUser ? (
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
              ) : (
                <div>
                  {(() => {
                    // Extract text from parts if message.content is empty but parts exist
                    let displayContent = message.content || '';
                    if (!displayContent.trim() && (message as any).parts) {
                      const textParts = (message as any).parts
                        .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
                        .map((p: any) => p.text);
                      if (textParts.length > 0) {
                        displayContent = textParts.join('\n\n');
                      }
                    }

                    if (displayContent.trim().length > 0) {
                      return <MarkdownRenderer content={displayContent} />;
                    }

                    if (isLoading && isLastAssistant) {
                      return (
                        <div className="flex items-center gap-2 py-2 text-xs text-indigo-400 animate-pulse">
                          <span>Synthesizing verified markdown comparison...</span>
                        </div>
                      );
                    }

                    return (
                      <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-300 text-xs flex items-center justify-between">
                        <span>No synthesis returned for this turn.</span>
                        <button
                          onClick={() => onSelectPrompt(messages[idx - 1]?.content || '')}
                          className="px-2 py-1 bg-amber-900/60 hover:bg-amber-800 rounded font-medium text-[11px] text-amber-200 transition-colors"
                        >
                          Retry Turn
                        </button>
                      </div>
                    );
                  })()}

                  {/* Trace details bar */}
                  {latestTrace && isLastAssistant && (
                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-emerald-400 font-semibold">
                          {latestTrace.latencies?.totalMs || 0}ms total
                        </span>
                        {latestTrace.temporalResolution && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono text-[10px]">
                            {latestTrace.temporalResolution.raw}
                          </span>
                        )}
                        {latestTrace.latencies.ttftMs && (
                          <span className="text-[10px] text-slate-500 font-mono">
                            TTFT: {latestTrace.latencies.ttftMs}ms
                          </span>
                        )}
                      </div>
                      <button
                        onClick={onOpenTrace}
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium hover:underline transition-colors"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        <span>Inspect X-Ray</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {isUser && (
              <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0 text-slate-300 mt-1 shadow-sm">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        );
      })}

      <div ref={bottomRef} />

      {/* Floating Scroll to Bottom pill */}
      {isUserScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600/90 hover:bg-indigo-600 text-white shadow-xl text-xs font-medium border border-indigo-400/40 backdrop-blur-sm transition-all"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>Jump to Latest</span>
        </button>
      )}
    </div>
  );
}

export const ChatViewport = memo(ChatViewportComponent);
