import { NextRequest, NextResponse } from 'next/server';
import { requireAppAdmin } from '@/lib/require-app-admin';

export async function GET() {
  const auth = await requireAppAdmin();
  if ('error' in auth) return auth.error;

  const { data, error } = await auth.supabase
    .from('calendar_events')
    .select('*')
    .order('event_date', { ascending: true });

  if (error) {
    console.error('admin calendar-events GET:', error);
    return NextResponse.json(
      { error: 'Could not load calendar events' },
      { status: 500 }
    );
  }
  return NextResponse.json({ events: data ?? [] });
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

  const event_date =
    typeof body.event_date === 'string' && body.event_date
      ? body.event_date
      : null;
  if (!event_date) {
    return NextResponse.json({ error: 'event_date is required' }, { status: 400 });
  }

  const description =
    typeof body.description === 'string'
      ? body.description.trim() || null
      : null;
  const location =
    typeof body.location === 'string' ? body.location.trim() || null : null;
  const event_url =
    typeof body.event_url === 'string' ? body.event_url.trim() || null : null;
  const is_featured = Boolean(body.is_featured);

  const { data, error } = await auth.supabase
    .from('calendar_events')
    .insert({
      title,
      description,
      event_date,
      location,
      event_url,
      is_featured,
      created_by: auth.user.id,
    })
    .select()
    .single();

  if (error) {
    console.error('admin calendar-events POST:', error);
    return NextResponse.json(
      { error: error.message || 'Insert failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ event: data });
}
