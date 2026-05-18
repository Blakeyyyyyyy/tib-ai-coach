'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Announcement } from '@/lib/types';
import { ArrowLeft, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';

function toLocalDatetimeValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyForm() {
  return {
    tag: 'Event',
    title: '',
    summary: '',
    description: '',
    event_date: '',
    starts_at: '',
    ends_at: '',
    published: false,
  };
}

export default function AdminAnnouncementsPage() {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/announcements');
      const json = (await res.json()) as {
        announcements?: Announcement[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'Could not load');
        setRows([]);
        return;
      }
      setRows(json.announcements ?? []);
    } catch {
      setError('Could not load announcements');
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

  const startEdit = (a: Announcement) => {
    setEditingId(a.id);
    setForm({
      tag: a.tag,
      title: a.title,
      summary: a.summary ?? '',
      description: a.description ?? '',
      event_date: toLocalDatetimeValue(a.event_date),
      starts_at: toLocalDatetimeValue(a.starts_at),
      ends_at: toLocalDatetimeValue(a.ends_at),
      published: a.published,
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        tag: form.tag.trim() || 'Event',
        title: form.title.trim(),
        summary: form.summary.trim() || null,
        description: form.description.trim() || null,
        event_date: form.event_date ? new Date(form.event_date).toISOString() : null,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        published: form.published,
      };

      if (!payload.title) {
        setError('Title is required');
        setSaving(false);
        return;
      }

      const url =
        editingId === null
          ? '/api/admin/announcements'
          : `/api/admin/announcements/${editingId}`;
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
    if (!confirm('Delete this announcement?')) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, {
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
        href="/dashboard"
        className="inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-800 mb-6"
      >
        <ArrowLeft size={16} />
        Back to dashboard
      </Link>

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 flex items-center gap-2">
            <Megaphone className="text-brand-500" size={28} />
            Announcements
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Published items appear as a popup when users open the app (once per
            item until they dismiss it).
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
            {editingId ? 'Edit announcement' : 'Create announcement'}
          </h2>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">
              Tag / label
            </label>
            <input
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={form.tag}
              onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
              placeholder="Event, News, Workshop…"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">
              Title <span className="text-red-600">*</span>
            </label>
            <input
              required
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Short headline"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">
              Summary
            </label>
            <input
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              placeholder="One line detail"
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
              placeholder="Longer copy for the popup"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-1">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">
                Event date & time
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                value={form.event_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, event_date: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">
                Show from
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                value={form.starts_at}
                onChange={(e) =>
                  setForm((f) => ({ ...f, starts_at: e.target.value }))
                }
              />
              <p className="text-xs text-ink-400 mt-1">
                Leave empty when publishing to start showing immediately.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">
                Hide after (optional)
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                value={form.ends_at}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ends_at: e.target.value }))
                }
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) =>
                setForm((f) => ({ ...f, published: e.target.checked }))
              }
              className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm font-medium text-ink-800">
              Published (visible to users)
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
            <h3 className="text-sm font-semibold text-ink-800">All items</h3>
          </div>
          {loading ? (
            <p className="p-6 text-sm text-ink-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-ink-500">No announcements yet.</p>
          ) : (
            <ul className="divide-y divide-ink-100 max-h-[70vh] overflow-y-auto">
              {rows.map((a) => (
                <li
                  key={a.id}
                  className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-ink-50/50"
                >
                  <div className="min-w-0">
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                      {a.tag}
                    </span>
                    <p className="font-medium text-ink-900 truncate">{a.title}</p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {a.published ? (
                        <span className="text-teal-600">Published</span>
                      ) : (
                        <span className="text-ink-400">Draft</span>
                      )}
                      {' · '}
                      {new Date(a.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(a)}
                      className="p-2 rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                      aria-label="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
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
