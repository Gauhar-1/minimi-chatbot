'use client';

import React, { useRef, useLayoutEffect, useEffect, KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface ChatComposerProps {
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e?: React.FormEvent) => void;
  isLoading: boolean;
  onStop?: () => void;
  placeholder?: string;
}

export function ChatComposer({
  input,
  onInputChange,
  onSubmit,
  isLoading,
  onStop,
  placeholder = 'Ask anything or explore past conversations...',
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height smoothly up to 220px (~8 lines)
  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 220);
    textarea.style.height = `${nextHeight}px`;
  };

  useLayoutEffect(() => {
    adjustHeight();
  }, [input]);

  useEffect(() => {
    adjustHeight();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (unless Shift is pressed or composition in progress)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isLoading && input.trim()) {
        onSubmit();
      }
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!isLoading && input.trim()) {
          onSubmit(e);
        }
      }}
      className="max-w-3xl mx-auto flex items-end gap-2.5 relative bg-[#121215] border border-white/[0.08] focus-within:border-white/[0.22] rounded-2xl px-3.5 py-2.5 transition-all shadow-xl"
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={input}
        onChange={(e) => {
          onInputChange(e);
          adjustHeight();
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[#f4f4f5] placeholder:text-zinc-500 text-[15px] leading-relaxed focus:outline-none resize-none max-h-[220px] py-1 font-sans selection:bg-zinc-700 selection:text-white"
      />

      <div className="flex items-center flex-shrink-0 mb-0.5">
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            className="w-8 h-8 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-rose-400 border border-white/[0.08] font-medium text-xs transition-all flex items-center justify-center shadow-md active:scale-95"
            title="Stop generation"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-8 h-8 rounded-xl bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800/80 disabled:text-zinc-600 font-medium text-sm transition-all flex items-center justify-center shadow-md disabled:cursor-not-allowed active:scale-95"
            title="Send prompt (Enter)"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}
      </div>
    </form>
  );
}
