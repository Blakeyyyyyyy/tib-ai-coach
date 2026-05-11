'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarEvent } from '@/lib/types';
import { Calendar, MapPin, ExternalLink, Loader2, Star } from 'lucide-react';

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('calendar_events')
        .select('*')
        .gte('event_date', new Date().toISOString())
        .order('event_date', { ascending: true });
      setEvents(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const formatEventDate = (iso: string) => {
    const d = new Date(iso);
    return {
      day: d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
      time: d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }),
      month: d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase(),
      date: d.getDate(),
    };
  };

  const groupByMonth = (evts: CalendarEvent[]) => {
    return evts.reduce<Record<string, CalendarEvent[]>>((acc, evt) => {
      const month = new Date(evt.event_date).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      if (!acc[month]) acc[month] = [];
      acc[month].push(evt);
      return acc;
    }, {});
  };

  const grouped = groupByMonth(events);

  return (
    <div className="min-h-screen bg-page px-4 lg:px-8 py-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shadow-sm">
              <Calendar size={18} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-ink-900">Upcoming Events</h1>
          </div>
          <p className="text-ink-400 text-sm ml-12">
            Workshops, coaching sessions, and events from Nicole and the TiB team.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-ink-300" />
          </div>
        ) : events.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([month, monthEvents]) => (
              <div key={month}>
                <h2 className="text-xs font-semibold text-ink-400 uppercase tracking-widest mb-3 pl-1">
                  {month}
                </h2>
                <div className="space-y-3">
                  {monthEvents.map((event) => {
                    const fmt = formatEventDate(event.event_date);
                    return (
                      <div
                        key={event.id}
                        className={`flex gap-4 p-5 rounded-2xl border bg-surface transition-shadow hover:shadow-sm ${
                          event.is_featured
                            ? 'border-brand-200 bg-brand-50/30'
                            : 'border-ink-100'
                        }`}
                      >
                        {/* Date block */}
                        <div className="shrink-0 w-14 text-center">
                          <div className="text-xs font-semibold text-brand-500 uppercase">{fmt.month}</div>
                          <div className="text-3xl font-bold text-ink-900 leading-tight">{fmt.date}</div>
                        </div>

                        {/* Divider */}
                        <div className="w-px bg-ink-100 shrink-0" />

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                {event.is_featured && (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 bg-brand-100 px-2 py-0.5 rounded-full">
                                    <Star size={10} className="fill-brand-500 text-brand-500" />
                                    Featured
                                  </span>
                                )}
                              </div>
                              <h3 className="text-base font-semibold text-ink-900">{event.title}</h3>
                            </div>
                            {event.event_url && (
                              <a
                                href={event.event_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 px-3 py-1.5 rounded-lg transition-colors"
                              >
                                Register
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-ink-400">
                            <span className="flex items-center gap-1">
                              <Calendar size={12} />
                              {fmt.day} · {fmt.time}
                            </span>
                            {event.location && (
                              <span className="flex items-center gap-1">
                                <MapPin size={12} />
                                {event.location}
                              </span>
                            )}
                          </div>

                          {event.description && (
                            <p className="text-sm text-ink-500 mt-2 leading-relaxed">{event.description}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* FOMO footer */}
        {!loading && events.length > 0 && (
          <div className="mt-10 p-5 rounded-2xl bg-ink-900 text-white text-center">
            <p className="font-semibold mb-1">Want access to all of Nicole&apos;s events?</p>
            <p className="text-sm text-ink-300 mb-3">
              Full coaching program members get exclusive workshops, live Q&As, and group sessions.
            </p>
            <a
              href="https://tradeinbusiness.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-400 hover:text-brand-300 transition-colors"
            >
              Learn about the full program <ExternalLink size={13} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-24">
      <div className="w-14 h-14 rounded-2xl bg-ink-50 border border-ink-100 flex items-center justify-center mx-auto mb-4">
        <Calendar size={24} className="text-ink-300" />
      </div>
      <h3 className="text-base font-semibold text-ink-700 mb-1">No upcoming events</h3>
      <p className="text-sm text-ink-400">Check back soon — Nicole&apos;s team will be adding events here.</p>
    </div>
  );
}
