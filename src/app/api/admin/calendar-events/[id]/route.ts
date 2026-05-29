import { NextRequest, NextResponse } from 'next/server';
import { requireAppAdmin } from '@/lib/require-app-admin';

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAppAdmin();
  if ('error' in auth) return auth.error;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) {
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    }
    patch.title = t;
  }
  if (body.description !== undefined) {
    patch.description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null;
  }
  if (body.event_date !== undefined) {
    if (typeof body.event_date !== 'string' || !body.event_date) {
      return NextResponse.json({ error: 'event_date is required' }, { status: 400 });
    }
    patch.event_date = body.event_date;
  }
  if (body.location !== undefined) {
    patch.location =
      typeof body.location === 'string' && body.location.trim()
        ? body.location.trim()
        : null;
  }
  if (body.event_url !== undefined) {
    patch.event_url =
      typeof body.event_url === 'string' && body.event_url.trim()
        ? body.event_url.trim()
        : null;
  }
  if (typeof body.is_featured === 'boolean') patch.is_featured = body.is_featured;

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('calendar_events')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('admin calendar-events PATCH:', error);
    return NextResponse.json(
      { error: error.message || 'Update failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ event: data });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAppAdmin();
  if ('error' in auth) return auth.error;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from('calendar_events')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('admin calendar-events DELETE:', error);
    return NextResponse.json(
      { error: error.message || 'Delete failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
