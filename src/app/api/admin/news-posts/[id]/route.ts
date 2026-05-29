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
  if (typeof body.body === 'string') {
    const b = body.body.trim();
    if (!b) {
      return NextResponse.json({ error: 'body cannot be empty' }, { status: 400 });
    }
    patch.body = b;
  }
  if (body.image_url !== undefined) {
    patch.image_url =
      typeof body.image_url === 'string' && body.image_url.trim()
        ? body.image_url.trim()
        : null;
  }
  if (typeof body.is_published === 'boolean') patch.is_published = body.is_published;

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('news_posts')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('admin news-posts PATCH:', error);
    return NextResponse.json(
      { error: error.message || 'Update failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ post: data });
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

  const { error } = await auth.supabase.from('news_posts').delete().eq('id', id);

  if (error) {
    console.error('admin news-posts DELETE:', error);
    return NextResponse.json(
      { error: error.message || 'Delete failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
