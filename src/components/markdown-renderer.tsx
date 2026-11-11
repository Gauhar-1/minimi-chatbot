'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body prose prose-invert max-w-none text-slate-200 text-sm leading-relaxed space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4 rounded-xl border border-slate-700/60 bg-slate-900/60 shadow-lg">
                <table className="min-w-full divide-y divide-slate-700/60 text-left text-xs sm:text-sm">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="bg-slate-800/80 text-slate-300 font-semibold uppercase tracking-wider text-[11px]">
                {children}
              </thead>
            );
          },
          tbody({ children }) {
            return (
              <tbody className="divide-y divide-slate-800/80 bg-slate-900/30">
                {children}
              </tbody>
            );
          },
          tr({ children }) {
            return (
              <tr className="hover:bg-slate-800/40 transition-colors">
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
              <td className="px-4 py-3 text-slate-300 align-top">
                {children}
              </td>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-indigo-400 hover:text-indigo-300 font-medium underline underline-offset-2 transition-colors"
              >
                <span>{children}</span>
                <ExternalLink className="w-3 h-3 opacity-70 ml-0.5 inline" />
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
            return <ul className="list-disc pl-5 space-y-1.5 my-2">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 space-y-1.5 my-2">{children}</ol>;
          },
          li({ children }) {
            return <li className="text-slate-300">{children}</li>;
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

