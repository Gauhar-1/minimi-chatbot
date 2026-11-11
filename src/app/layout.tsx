import type { Metadata } from 'next';
import { ChatErrorBoundary } from '@/components/error-boundary';
import './globals.css';

export const metadata: Metadata = {
  title: 'Minimi — Temporal Web-Search Agent',
  description:
    'A production-grade Temporal Web-Search Chat Agent with deterministic chrono resolution, SQLite hybrid episodic memory, and deep pricing verification.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0d14] text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
        <ChatErrorBoundary>
          {children}
        </ChatErrorBoundary>
      </body>
    </html>
  );
}

