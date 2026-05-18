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

  const patch: Record<string, unknown> = {};
  if (typeof body.tag === 'string') patch.tag = body.tag.trim() || 'Event';
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) {
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    }
    patch.title = t;
  }
  if (body.summary !== undefined) {
    patch.summary =
      typeof body.summary === 'string' && body.summary.trim()
        ? body.summary.trim()
        : null;
  }
  if (body.description !== undefined) {
    patch.description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null;
  }
  if (body.event_date !== undefined) {
    patch.event_date =
      typeof body.event_date === 'string' && body.event_date
        ? body.event_date
        : null;
  }
  if (typeof body.published === 'boolean') patch.published = body.published;
  if (body.starts_at !== undefined) {
    patch.starts_at =
      typeof body.starts_at === 'string' && body.starts_at
        ? body.starts_at
        : null;
  }
  if (body.ends_at !== undefined) {
    patch.ends_at =
      typeof body.ends_at === 'string' && body.ends_at ? body.ends_at : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('announcements')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('admin announcements PATCH:', error);
    return NextResponse.json(
      { error: error.message || 'Update failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ announcement: data });
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

  const { error } = await auth.supabase.from('announcements').delete().eq('id', id);

  if (error) {
    console.error('admin announcements DELETE:', error);
    return NextResponse.json(
      { error: error.message || 'Delete failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
