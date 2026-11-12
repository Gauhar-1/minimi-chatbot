'use client';

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

function extractDomain(href?: string): string {
  if (!href) return '';
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href.slice(0, 20);
  }
}

function MarkdownRendererComponent({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body prose prose-invert max-w-none text-[#f4f4f5] text-sm leading-relaxed space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4 rounded-xl border border-white/[0.08] bg-zinc-900/50 shadow-xl overflow-hidden">
                <table className="min-w-full divide-y divide-white/[0.08] text-left text-xs sm:text-sm">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="bg-zinc-900/80 text-zinc-400 font-semibold uppercase tracking-wider text-[11px] border-b border-white/[0.08]">
                {children}
              </thead>
            );
          },
          tbody({ children }) {
            return (
              <tbody className="divide-y divide-white/[0.05] bg-zinc-950/40">
                {children}
              </tbody>
            );
          },
          tr({ children }) {
            return (
              <tr className="hover:bg-white/[0.03] transition-colors">
                {children}
              </tr>
            );
          },
          th({ children }) {
            return (
              <th className="px-4 py-3 font-semibold text-zinc-400 whitespace-nowrap">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-4 py-3 text-zinc-200 align-top leading-relaxed tabular-nums">
                {children}
              </td>
            );
          },
          a({ href, children }) {
            const domain = extractDomain(href);
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 my-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-xs text-zinc-200 transition-colors align-baseline no-underline group shadow-sm border border-white/[0.04]"
                title={href}
              >
                <span className="font-sans font-medium text-zinc-200">
                  {children || domain}
                </span>
                {domain && (
                  <span className="text-[10px] text-zinc-400 group-hover:text-zinc-200">
                    ({domain})
                  </span>
                )}
                <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 flex-shrink-0" />
              </a>
            );
          },
          strong({ children }) {
            return <strong className="font-semibold text-white">{children}</strong>;
          },
          code({ children }) {
            return (
              <code className="px-1.5 py-0.5 bg-zinc-900 rounded text-zinc-300 text-xs font-mono border border-white/[0.08]">
                {children}
              </code>
            );
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 space-y-1.5 my-2 text-zinc-300">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 space-y-1.5 my-2 text-zinc-300">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-indigo-500/80 pl-4 py-1 italic bg-indigo-950/20 rounded-r-lg my-2 text-zinc-300">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Wrap in React.memo so token streaming in new chunks does not re-parse historical turns
export const MarkdownRenderer = memo(MarkdownRendererComponent);
