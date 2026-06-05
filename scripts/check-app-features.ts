/**
 * Verify Supabase tables + sample data for admin/calendar/announcements/tasks.
 * Usage: npx tsx scripts/check-app-features.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  console.log('=== Supabase feature check ===\n');

  async function countTable(
    table: string,
    applyFilter?: (q: ReturnType<typeof admin.from>) => ReturnType<typeof admin.from>
  ) {
    let q = admin.from(table).select('id', { count: 'exact', head: true });
    if (applyFilter) q = applyFilter(q);
    const { count, error } = await q;
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: count ?? 0 };
  }

  const checks: [string, () => Promise<{ ok: boolean; count?: number; error?: string }>][] = [
    ['tasks', () => countTable('tasks')],
    [
      'calendar_events (upcoming)',
      () => countTable('calendar_events', (q) => q.gte('event_date', now)),
    ],
    ['calendar_events (all)', () => countTable('calendar_events')],
    ['announcements', () => countTable('announcements')],
    [
      'announcements (published)',
      () => countTable('announcements', (q) => q.eq('is_published', true)),
    ],
    [
      'news_posts (published)',
      () => countTable('news_posts', (q) => q.eq('is_published', true)),
    ],
    ['app_admins', () => countTable('app_admins')],
    ['conversations', () => countTable('conversations')],
  ];

  for (const [name, fn] of checks) {
    const r = await fn();
    if (r.ok && r.count !== undefined) console.log(`OK   ${name}: ${r.count}`);
    else console.log(`FAIL ${name}: ${r.error}`);
  }

  const mem = await admin
    .from('conversations')
    .select('memory_summary, summary_updated_at')
    .limit(1);
  if (mem.error?.message.includes('memory_summary')) {
    console.log('FAIL memory_summary column: not migrated');
  } else if (mem.error) {
    console.log('FAIL memory_summary column:', mem.error.message);
  } else {
    console.log('OK   memory_summary column: present');
  }

  const { data: admins, error: adminErr } = await admin
    .from('app_admins')
    .select('user_id, created_at');
  if (adminErr) console.log('\nFAIL app_admins query:', adminErr.message);
  else {
    console.log(`\napp_admins: ${admins?.length ?? 0} user(s)`);
    for (const a of admins ?? []) console.log(`  - ${a.user_id}`);
  }

  const { data: announcements } = await admin
    .from('announcements')
    .select('title, is_published, starts_at, ends_at')
    .limit(5);
  if (!announcements?.length) console.log('\nAnnouncements: none in DB (popup will not show)');
  else {
    console.log('\nAnnouncements:');
    for (const a of announcements) {
      console.log(`  - ${a.title} | published: ${a.is_published}`);
    }
  }

  const { data: events } = await admin
    .from('calendar_events')
    .select('title, event_date')
    .gte('event_date', now)
    .order('event_date', { ascending: true })
    .limit(3);
  if (!events?.length) console.log('\nCalendar: no upcoming events');
  else {
    console.log('\nUpcoming calendar:');
    for (const e of events) console.log(`  - ${e.title} | ${e.event_date}`);
  }

  const { data: tasks } = await admin
    .from('tasks')
    .select('title, status, source')
    .order('created_at', { ascending: false })
    .limit(3);
  if (!tasks?.length) console.log('\nTasks: none in DB yet');
  else {
    console.log('\nRecent tasks:');
    for (const t of tasks) console.log(`  - ${t.title} | ${t.status} | ${t.source}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
