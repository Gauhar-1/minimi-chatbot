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
    <div className="markdown-body prose prose-invert max-w-none text-slate-200 text-sm leading-relaxed space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4 rounded-xl border border-slate-700/80 bg-slate-950/90 shadow-xl">
                <table className="min-w-full divide-y divide-slate-700/80 text-left text-xs sm:text-sm">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-slate-200 font-semibold uppercase tracking-wider text-[11px] border-b border-slate-700/80">
                {children}
              </thead>
            );
          },
          tbody({ children }) {
            return (
              <tbody className="divide-y divide-slate-800/80 bg-slate-950/50">
                {children}
              </tbody>
            );
          },
          tr({ children }) {
            return (
              <tr className="hover:bg-slate-800/40 odd:bg-slate-900/30 even:bg-slate-900/10 transition-colors">
                {children}
              </tr>
            );
          },
          th({ children }) {
            return (
              <th className="px-4 py-3 font-semibold text-slate-200 whitespace-nowrap">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-4 py-3 text-slate-300 align-top leading-relaxed">
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
                className="inline-flex items-center gap-1 px-2 py-0.5 my-0.5 rounded-full bg-slate-800/90 hover:bg-indigo-950/80 text-indigo-300 hover:text-indigo-200 border border-slate-700/60 hover:border-indigo-600/60 font-mono text-xs transition-colors duration-150 align-baseline no-underline group shadow-sm"
                title={href}
              >
                <span className="font-sans font-medium text-slate-200">{children}</span>
                {domain && (
                  <span className="text-[10px] text-slate-400 group-hover:text-indigo-300">
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
              <code className="px-1.5 py-0.5 bg-slate-800/80 rounded text-indigo-300 text-xs font-mono border border-slate-700/40">
                {children}
              </code>
            );
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 space-y-1.5 my-2 text-slate-300">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 space-y-1.5 my-2 text-slate-300">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-indigo-500/80 pl-4 py-1 italic bg-indigo-950/20 rounded-r-lg my-2 text-slate-300">
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
