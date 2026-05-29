'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { CalendarEvent } from '@/lib/types';
import { ArrowLeft, Calendar, Pencil, Plus, Star, Trash2 } from 'lucide-react';

function toLocalDatetimeValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyForm() {
  return {
    title: '',
    description: '',
    event_date: '',
    location: '',
    event_url: '',
    is_featured: false,
  };
}

export default function AdminCalendarPage() {
  const [rows, setRows] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/calendar-events');
      const json = (await res.json()) as {
        events?: CalendarEvent[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'Could not load events');
        setRows([]);
        return;
      }
      setRows(json.events ?? []);
    } catch {
      setError('Could not load events');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const startEdit = (event: CalendarEvent) => {
    setEditingId(event.id);
    setForm({
      title: event.title,
      description: event.description ?? '',
      event_date: toLocalDatetimeValue(event.event_date),
      location: event.location ?? '',
      event_url: event.event_url ?? '',
      is_featured: event.is_featured,
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        event_date: form.event_date
          ? new Date(form.event_date).toISOString()
          : null,
        location: form.location.trim() || null,
        event_url: form.event_url.trim() || null,
        is_featured: form.is_featured,
      };

      if (!payload.title) {
        setError('Title is required');
        setSaving(false);
        return;
      }
      if (!payload.event_date) {
        setError('Event date is required');
        setSaving(false);
        return;
      }

      const url =
        editingId === null
          ? '/api/admin/calendar-events'
          : `/api/admin/calendar-events/${editingId}`;
      const method = editingId === null ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Save failed');
        setSaving(false);
        return;
      }

      await load();
      startCreate();
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this event?')) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/calendar-events/${id}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Delete failed');
        return;
      }
      if (editingId === id) startCreate();
      await load();
    } catch {
      setError('Delete failed');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-16">
      <Link
        href="/admin"
        className="inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-800 mb-6"
      >
        <ArrowLeft size={16} />
        Back to admin
      </Link>

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 flex items-center gap-2">
            <Calendar className="text-brand-500" size={28} />
            Calendar events
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Events appear on the Calendar page for all logged-in users.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 shrink-0"
        >
          <Plus size={18} />
          New
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <form
          onSubmit={submit}
          className="rounded-xl border border-ink-100 bg-surface p-6 shadow-sm space-y-4"
        >
          <h2 className="text-lg font-semibold text-ink-900">
            {editingId ? 'Edit event' : 'Create event'}
          </h2>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">
              Title <span className="text-red-600">*</span>
            </label>
            <input
              required
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Workshop title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">
              Event date & time <span className="text-red-600">*</span>
            </label>
            <input
              type="datetime-local"
              required
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={form.event_date}
              onChange={(e) =>
                setForm((f) => ({ ...f, event_date: e.target.value }))
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">
              Location
            </label>
            <input
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              placeholder="Online / Sydney / etc."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">
              Registration URL
            </label>
            <input
              type="url"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={form.event_url}
              onChange={(e) => setForm((f) => ({ ...f, event_url: e.target.value }))}
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">
              Description
            </label>
            <textarea
              rows={4}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-y min-h-[100px]"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="What is this event about?"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_featured}
              onChange={(e) =>
                setForm((f) => ({ ...f, is_featured: e.target.checked }))
              }
              className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm font-medium text-ink-800 flex items-center gap-1">
              <Star size={14} className="text-brand-500" />
              Featured event
            </span>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={startCreate}
                className="rounded-lg border border-ink-200 px-5 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>

        <div className="rounded-xl border border-ink-100 bg-surface overflow-hidden shadow-sm">
          <div className="border-b border-ink-100 px-4 py-3 bg-ink-50/80">
            <h3 className="text-sm font-semibold text-ink-800">All events</h3>
          </div>
          {loading ? (
            <p className="p-6 text-sm text-ink-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-ink-500">No events yet.</p>
          ) : (
            <ul className="divide-y divide-ink-100 max-h-[70vh] overflow-y-auto">
              {rows.map((event) => (
                <li
                  key={event.id}
                  className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-ink-50/50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900 truncate">{event.title}</p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {new Date(event.event_date).toLocaleString('en-AU')}
                      {event.is_featured && (
                        <>
                          {' · '}
                          <span className="text-brand-600">Featured</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(event)}
                      className="p-2 rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                      aria-label="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(event.id)}
                      className="p-2 rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-700"
                      aria-label="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
