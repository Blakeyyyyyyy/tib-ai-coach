'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Announcement } from '@/lib/types';
import { Calendar, Sparkles, X } from 'lucide-react';

const STORAGE_KEY = 'tib_dismissed_announcements';

function isActiveAnnouncement(a: Announcement): boolean {
  if (!a.published) return false;
  const now = Date.now();
  if (a.starts_at) {
    const start = new Date(a.starts_at).getTime();
    if (!Number.isNaN(start) && start > now) return false;
  }
  if (a.ends_at) {
    const end = new Date(a.ends_at).getTime();
    if (!Number.isNaN(end) && end < now) return false;
  }
  return true;
}

function loadDismissed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  } catch {
    return null;
  }
}

export default function AnnouncementPopup() {
  const [hydrated, setHydrated] = useState(false);
  const [queue, setQueue] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnnouncements = useCallback(async () => {
    try {
      const res = await fetch('/api/announcements');
      const json = (await res.json()) as {
        announcements?: Announcement[];
        error?: string;
      };
      if (!res.ok || !json.announcements) {
        setQueue([]);
        return;
      }
      const seen = loadDismissed();
      const unseen = json.announcements
        .filter(isActiveAnnouncement)
        .filter((a) => !seen.includes(a.id));
      setQueue(unseen);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    fetchAnnouncements();
  }, [hydrated, fetchAnnouncements]);

  /** Optional live refresh when Realtime is enabled on `announcements` in Supabase. */
  useEffect(() => {
    if (!hydrated) return;
    const supabase = createClient();
    const channel = supabase
      .channel('announcements-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => {
          fetchAnnouncements();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hydrated, fetchAnnouncements]);

  const current = queue[0];

  const dismissCurrent = useCallback(() => {
    if (!current) return;
    const prev = loadDismissed();
    const next = [...prev, current.id];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
    setQueue((q) => q.slice(1));
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissCurrent();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, dismissCurrent]);

  if (!hydrated || loading || !current) return null;

  const dateLine =
    formatWhen(current.event_date) ?? formatWhen(current.starts_at);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close announcement"
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px] transition-opacity"
        onClick={dismissCurrent}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-title"
        className="relative w-full max-w-md rounded-2xl border border-ink-100 bg-surface shadow-xl shadow-ink-900/10 overflow-hidden motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out opacity-100 scale-100"
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand-500 via-brand-400 to-teal-400" />

        <button
          type="button"
          onClick={dismissCurrent}
          className="absolute top-3 right-3 z-10 rounded-lg p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-700 transition-colors"
          aria-label="Dismiss"
        >
          <X size={18} />
        </button>

        <div className="p-6 pt-8">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 border border-brand-100">
              <Sparkles size={20} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <span className="inline-flex items-center rounded-full bg-ink-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-700 border border-brand-100">
                {current.tag}
              </span>
              <h2
                id="announcement-title"
                className="mt-2 text-lg font-semibold text-ink-900 leading-snug pr-6"
              >
                {current.title}
              </h2>
            </div>
          </div>

          {current.summary && (
            <p className="text-sm font-medium text-ink-700 mb-3 leading-relaxed">
              {current.summary}
            </p>
          )}

          {dateLine && (
            <div className="flex items-center gap-2 text-xs text-ink-500 mb-3">
              <Calendar size={14} className="shrink-0 opacity-80" />
              <span>{dateLine}</span>
            </div>
          )}

          {current.description && (
            <p className="text-sm text-ink-600 leading-relaxed whitespace-pre-wrap mb-6">
              {current.description}
            </p>
          )}

          {!current.summary && !current.description && !dateLine && (
            <div className="mb-6" />
          )}

          <button
            type="button"
            onClick={dismissCurrent}
            className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
