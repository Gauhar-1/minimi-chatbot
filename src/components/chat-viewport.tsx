'use client';

import React, { useEffect, useRef } from 'react';
import type { Message } from 'ai';
import { MarkdownRenderer } from './markdown-renderer';
import { PipelineStepper } from './pipeline-stepper';
import { User, Bot, Activity } from 'lucide-react';
import type { PipelinePhaseEvent, TurnTracePayload } from '@/core/contracts/trace.contract';

interface ChatViewportProps {
  messages: Message[];
  isLoading: boolean;
  activeEvents: PipelinePhaseEvent[];
  latestTrace: TurnTracePayload | null;
  onOpenTrace: () => void;
}

export function ChatViewport({
  messages,
  isLoading,
  activeEvents,
  latestTrace,
  onOpenTrace,
}: ChatViewportProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or stream chunks
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeEvents]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400">
          <Bot className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-semibold text-white mb-1">
          Minimi Temporal Web-Search Agent
        </h2>
        <p className="text-xs max-w-md text-slate-400 leading-relaxed mb-6">
          Pre-inference temporal reasoning via <code className="text-indigo-300">chrono-node</code>,
          episodic memory with SQLite <code className="text-indigo-300">FTS5</code> + local vectors,
          and parallel live web search with deep pricing table extraction.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl w-full mx-auto">
      {messages.map((message, idx) => {
        const isUser = message.role === 'user';
        const isLastAssistant = !isUser && idx === messages.length - 1;

        return (
          <div
            key={message.id || idx}
            className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            {!isUser && (
              <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 text-indigo-400 mt-1">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              className={`max-w-[88%] sm:max-w-[80%] rounded-2xl p-4 shadow-sm ${
                isUser
                  ? 'bg-indigo-600 text-white rounded-tr-none font-medium text-sm'
                  : 'bg-slate-900/80 border border-slate-800 text-slate-200 rounded-tl-none'
              }`}
            >
              {/* Show live pipeline stepper if this is the active turn */}
              {isLastAssistant && isLoading && activeEvents.length > 0 && (
                <div className="mb-3">
                  <PipelineStepper events={activeEvents} isStreaming={isLoading} />
                </div>
              )}

              {/* Render content */}
              {isUser ? (
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
              ) : (
                <div>
                  <MarkdownRenderer content={message.content} />

                  {/* Trace Inspector shortcut footer on assistant messages */}
                  {latestTrace && isLastAssistant && (
                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-emerald-400">
                          {latestTrace.latencies?.totalMs || 0}ms total
                        </span>
                        {latestTrace.temporalResolution && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono text-[10px]">
                            {latestTrace.temporalResolution.raw}
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
              <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0 text-slate-300 mt-1">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}

