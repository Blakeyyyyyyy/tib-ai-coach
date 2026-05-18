'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { MessageSquarePlus } from 'lucide-react';
import type { Conversation } from '@/lib/types';
import { useCoachSessions } from '@/contexts/CoachSessionsContext';

function formatRelative(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (86400 * 1000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ConversationPanel({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const { listVersion } = useCoachSessions();
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const isNewChatRoute = pathname === '/coach';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setRows([]);
        return;
      }
      const { data, error } = await supabase
        .from('conversations')
        .select('id, user_id, title, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (!cancelled && !error && data) setRows(data);
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [listVersion]);

  const panelContent = (
    <>
      <div className="p-2 pt-3 shrink-0 border-b border-black/5">
        <Link
          href="/coach"
          onClick={onMobileClose}
          className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-colors border ${
            isNewChatRoute
              ? 'bg-surface border-black/10 shadow-sm text-ink-900'
              : 'border-transparent text-ink-800 hover:bg-black/[0.04]'
          }`}
        >
          <MessageSquarePlus size={18} strokeWidth={1.75} className="shrink-0 text-ink-600" />
          New chat
        </Link>
      </div>

      <div className="px-3 pt-3 pb-1">
        <h2 className="px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Recent
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 min-h-0">
        {loading ? (
          <p className="text-xs text-ink-400 px-2 py-3">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-ink-400 px-2 py-2 leading-relaxed">
            No chats yet. Start with <span className="font-medium text-ink-500">New chat</span>.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((c) => {
              const isThreadActive = pathname === `/coach/${c.id}`;
              return (
                <li key={c.id}>
                  <Link
                    href={`/coach/${c.id}`}
                    onClick={onMobileClose}
                    className={`group flex flex-col rounded-lg px-3 py-2 text-left transition-colors ${
                      isThreadActive
                        ? 'bg-black/[0.07] text-ink-900'
                        : 'text-ink-700 hover:bg-black/[0.05]'
                    }`}
                  >
                    <span className="text-[13px] leading-snug line-clamp-2 break-words font-medium">
                      {c.title || 'New chat'}
                    </span>
                    <span className="text-[11px] text-ink-400 mt-0.5 tabular-nums">
                      {formatRelative(c.updated_at)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );

  const asideClass =
    'flex flex-col bg-[#f4f4f5] h-full min-h-0 lg:border-r lg:border-black/[0.06]';

  return (
    <>
      <aside className={`hidden lg:flex w-[272px] shrink-0 ${asideClass}`}>{panelContent}</aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[60] flex">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
            aria-label="Close chat list"
            onClick={onMobileClose}
          />
          <aside className={`relative z-[61] w-[min(20rem,88vw)] shadow-2xl ${asideClass}`}>
            {panelContent}
          </aside>
        </div>
      )}
    </>
  );
}
