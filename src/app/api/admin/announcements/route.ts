import { NextRequest, NextResponse } from 'next/server';
import { requireAppAdmin } from '@/lib/require-app-admin';

/** All rows (including drafts) for the admin UI — uses your Supabase session + RLS. */
export async function GET() {
  const auth = await requireAppAdmin();
  if ('error' in auth) return auth.error;

  const { data, error } = await auth.supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('admin announcements GET:', error);
    return NextResponse.json(
      { error: 'Could not load announcements' },
      { status: 500 }
    );
  }
  return NextResponse.json({ announcements: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAppAdmin();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const tag =
    typeof body.tag === 'string' && body.tag.trim()
      ? body.tag.trim()
      : 'Event';
  const summary =
    typeof body.summary === 'string' ? body.summary.trim() || null : null;
  const description =
    typeof body.description === 'string'
      ? body.description.trim() || null
      : null;
  const event_date =
    typeof body.event_date === 'string' && body.event_date
      ? body.event_date
      : null;
  const published = Boolean(body.published);
  const starts_at =
    typeof body.starts_at === 'string' && body.starts_at
      ? body.starts_at
      : published
        ? new Date().toISOString()
        : null;
  const ends_at =
    typeof body.ends_at === 'string' && body.ends_at ? body.ends_at : null;

  const { data, error } = await auth.supabase
    .from('announcements')
    .insert({
      tag,
      title,
      summary,
      description,
      event_date,
      published,
      starts_at,
      ends_at,
    })
    .select()
    .single();

  if (error) {
    console.error('admin announcements POST:', error);
    return NextResponse.json(
      { error: error.message || 'Insert failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ announcement: data });
}
