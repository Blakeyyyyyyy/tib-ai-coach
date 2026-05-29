import { NextRequest, NextResponse } from 'next/server';
import { requireAppAdmin } from '@/lib/require-app-admin';

export async function GET() {
  const auth = await requireAppAdmin();
  if ('error' in auth) return auth.error;

  const { data, error } = await auth.supabase
    .from('news_posts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('admin news-posts GET:', error);
    return NextResponse.json(
      { error: 'Could not load news posts' },
      { status: 500 }
    );
  }
  return NextResponse.json({ posts: data ?? [] });
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

  const postBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!postBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }

  const image_url =
    typeof body.image_url === 'string' ? body.image_url.trim() || null : null;
  const is_published =
    body.is_published !== undefined ? Boolean(body.is_published) : true;

  const { data, error } = await auth.supabase
    .from('news_posts')
    .insert({
      title,
      body: postBody,
      image_url,
      is_published,
      created_by: auth.user.id,
    })
    .select()
    .single();

  if (error) {
    console.error('admin news-posts POST:', error);
    return NextResponse.json(
      { error: error.message || 'Insert failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ post: data });
}
