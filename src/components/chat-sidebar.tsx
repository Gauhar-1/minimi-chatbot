'use client';

import React from 'react';
import {
  Plus,
  Trash2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

export interface SessionItem {
  id: string;
  userId: string;
  title: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

interface ChatSidebarProps {
  sessions: SessionItem[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteSession: (sessionId: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  devMode?: boolean;
  activeUserId: string;
  onChangeUserId: (userId: string) => void;
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  isOpen,
  onToggleOpen,
  devMode = false,
  activeUserId,
  onChangeUserId,
}: ChatSidebarProps) {
  // Group sessions into Today, Last 7 Days, and Older
  const now = new Date().getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * oneDayMs;

  const todaySessions: SessionItem[] = [];
  const last7DaysSessions: SessionItem[] = [];
  const olderSessions: SessionItem[] = [];

  for (const session of sessions) {
    const sessionTime = new Date(session.updatedAtUtc || session.createdAtUtc).getTime();
    const diff = now - sessionTime;
    if (diff < oneDayMs) {
      todaySessions.push(session);
    } else if (diff < sevenDaysMs) {
      last7DaysSessions.push(session);
    } else {
      olderSessions.push(session);
    }
  }

  const renderSessionGroup = (title: string, list: SessionItem[]) => {
    if (list.length === 0) return null;
    return (
      <div className="mb-4">
        <h3 className="px-3 mb-1.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
          {title}
        </h3>
        <div className="space-y-0.5">
          {list.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={`group relative flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all ${
                  isActive
                    ? 'bg-zinc-800/90 text-white font-medium border border-white/[0.08] shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate mr-2">
                  <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-indigo-400' : 'text-zinc-500'}`} />
                  <span className="truncate">{s.title || 'Untitled Session'}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 transition-opacity p-1 rounded-md hover:bg-zinc-800 flex-shrink-0"
                  title="Delete session"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onToggleOpen}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
        />
      )}

      {/* Sidebar Drawer */}
      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-40 w-64 bg-zinc-950 border-r border-white/[0.07] flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:hidden'
        }`}
      >
        {/* Top Header & New Chat button */}
        <div className="p-3 border-b border-white/[0.07] flex items-center gap-2">
          <button
            onClick={onNewChat}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-850 hover:bg-zinc-800 text-zinc-200 border border-white/[0.08] text-xs font-medium transition-all shadow-sm active:scale-98"
            title="Start fresh conversation (Cmd+K)"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>New Chat</span>
            <kbd className="hidden sm:inline-block ml-auto text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded border border-white/[0.06]">
              ⌘K
            </kbd>
          </button>

          <button
            onClick={onToggleOpen}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Session History */}
        <div className="flex-1 overflow-y-auto px-2 py-3 scrollbar-thin">
          {sessions.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500">
              No conversations yet.
            </div>
          ) : (
            <>
              {renderSessionGroup('Today', todaySessions)}
              {renderSessionGroup('Last 7 Days', last7DaysSessions)}
              {renderSessionGroup('Older', olderSessions)}
            </>
          )}
        </div>

        {/* Bottom Dev Mode Isolation Switcher */}
        {devMode && (
          <div className="p-3 border-t border-white/[0.07] bg-zinc-950/90 text-xs">
            <div className="flex items-center gap-1.5 text-zinc-400 mb-2 font-medium text-[11px]">
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span>Multi-Tenant Proof:</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <button
                type="button"
                onClick={() => onChangeUserId('usr_evaluator')}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border text-left transition-all ${
                  activeUserId === 'usr_evaluator'
                    ? 'bg-indigo-950/70 border-indigo-700/70 text-indigo-200 shadow-sm'
                    : 'bg-zinc-900/60 border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" />
                <div className="truncate">
                  <div className="truncate font-semibold">Evaluator (Seeded)</div>
                  <div className="text-[10px] text-zinc-500 truncate">usr_evaluator · 3 sessions</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onChangeUserId('usr_isolated_guest')}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border text-left transition-all ${
                  activeUserId === 'usr_isolated_guest'
                    ? 'bg-indigo-950/70 border-indigo-700/70 text-indigo-200 shadow-sm'
                    : 'bg-zinc-900/60 border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                <div className="truncate">
                  <div className="truncate font-semibold">Fresh Isolated User</div>
                  <div className="text-[10px] text-zinc-500 truncate">usr_isolated_guest · 0 bleed</div>
                </div>
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
