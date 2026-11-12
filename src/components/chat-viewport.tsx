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
  invariantDescription?: string;
}

export const MINIMI_CHALLENGE_PROMPTS: ChallengePrompt[] = [
  {
    id: 'monday_crm',
    label: 'CRM Pricing Delta',
    prompt:
      'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
    invariantDescription: '[Tests: chrono-node + 5x Parallel Search]',
  },
  {
    id: 'nov3_vectordb',
    label: 'Nov 3 Verification',
    prompt:
      'What did I ask you on 3 November? Is your answer still correct today?',
    invariantDescription: '[Tests: Past nov3 Anchor + Episodic Baseline]',
  },
  {
    id: 'tuesday_postgres',
    label: 'Postgres Hosting',
    prompt:
      'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
    invariantDescription: '[Tests: Tuesday Anchor + Readability Scraper]',
  },
  {
    id: 'empty_guard',
    label: '19 Aug Memory Check',
    prompt:
      'What did I ask you on 19 August? Is your answer still correct?',
    isGuard: true,
    invariantDescription: '[Tests: EMPTY_FOR_DATE_WINDOW Guard]',
  },
];

interface ChatViewportProps {
  messages: Message[];
  isLoading: boolean;
  activeEvents: PipelinePhaseEvent[];
  latestTrace: TurnTracePayload | null;
  devMode?: boolean;
  onOpenTrace: () => void;
  onSelectPrompt: (prompt: string) => void;
  onRetryTurn?: () => void;
}

function ChatViewportComponent({
  messages,
  isLoading,
  activeEvents,
  latestTrace,
  devMode = false,
  onOpenTrace,
  onSelectPrompt,
  onRetryTurn,
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
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-400 max-w-3xl mx-auto w-full">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/[0.08] flex items-center justify-center mb-4 text-zinc-200 shadow-lg shadow-black/40">
          <Bot className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-[#f4f4f5] mb-2 tracking-tight">
          Where would you like to start?
        </h2>
        <p className="text-xs max-w-md text-zinc-400 leading-relaxed mb-8">
          Search with temporal awareness, recall episodic memories, and verify SaaS pricing and technical changes.
        </p>

        {/* 2x2 Grid of Starter Prompt Cards */}
        <div className="w-full text-left space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MINIMI_CHALLENGE_PROMPTS.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelectPrompt(p.prompt)}
                className={`p-4 rounded-xl border text-left transition-all duration-200 hover:shadow-lg active:scale-[0.99] group bg-[#121215] border-white/[0.08] hover:border-white/[0.18]`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-medium text-xs text-zinc-200 group-hover:text-white flex items-center gap-1.5">
                    {p.isGuard && <ShieldAlert className="w-3.5 h-3.5 text-zinc-400" />}
                    {p.label}
                  </span>
                  {devMode && p.invariantDescription && (
                    <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-900 border border-white/[0.06]">
                      {p.invariantDescription}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-zinc-400 line-clamp-2 leading-relaxed">
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
              <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-white/[0.08] flex items-center justify-center flex-shrink-0 text-zinc-300 mt-1 shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              className={`max-w-[88%] sm:max-w-[82%] rounded-2xl p-4 shadow-sm ${
                isUser
                  ? 'bg-zinc-800 text-white rounded-tr-none font-normal text-sm'
                  : 'bg-[#121215] border border-white/[0.08] text-[#f4f4f5] rounded-tl-none'
              }`}
            >
              {/* Show live pipeline stepper during turn generation */}
              {isLastAssistant && (isLoading || activeEvents.length > 0) && (
                <div className="mb-3">
                  <PipelineStepper
                    events={activeEvents}
                    isStreaming={isLoading}
                    devMode={devMode}
                  />
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
                      return null;
                    }

                    // Zero error leak recovery card
                    return (
                      <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] text-xs flex items-center justify-between text-zinc-300">
                        <span>I hit a brief connection snag while verifying those sources.</span>
                        <button
                          onClick={() => {
                            if (onRetryTurn) onRetryTurn();
                            else onSelectPrompt(messages[idx - 1]?.content || '');
                          }}
                          className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/[0.08] rounded-md font-medium text-[11px] transition-colors"
                        >
                          Retry
                        </button>
                      </div>
                    );
                  })()}

                  {/* Dev Mode Trace Details Bar */}
                  {devMode && latestTrace && isLastAssistant && (
                    <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-semibold tabular-nums">
                          {latestTrace.latencies?.totalMs || 0}ms total
                        </span>
                        {latestTrace.temporalResolution && (
                          <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 text-[10px] border border-white/[0.06]">
                            {latestTrace.temporalResolution.raw}
                          </span>
                        )}
                        {latestTrace.latencies.ttftMs && (
                          <span className="text-[10px] text-zinc-500 tabular-nums">
                            TTFT: {latestTrace.latencies.ttftMs}ms
                          </span>
                        )}
                      </div>
                      <button
                        onClick={onOpenTrace}
                        className="inline-flex items-center gap-1 text-zinc-300 hover:text-white transition-colors"
                      >
                        <Activity className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Inspect X-Ray</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {isUser && (
              <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-white/[0.08] flex items-center justify-center flex-shrink-0 text-zinc-300 mt-1 shadow-sm">
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
          className="sticky bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/90 hover:bg-zinc-800 text-white shadow-xl text-xs font-medium border border-white/[0.1] backdrop-blur-sm transition-all"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>Jump to Latest</span>
        </button>
      )}
    </div>
  );
}

export const ChatViewport = memo(ChatViewportComponent);
