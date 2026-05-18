import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Active published announcements for the signed-in user (RLS applies). */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('announcements')
      .select(
        'id, tag, title, summary, description, event_date, published, starts_at, ends_at, created_at, updated_at'
      )
      .order('created_at', { ascending: false });

    if (error) {
      console.error('announcements GET:', error.message);
      return NextResponse.json(
        { error: 'Could not load announcements' },
        { status: 500 }
      );
    }

    return NextResponse.json({ announcements: data ?? [] });
  } catch (e) {
    console.error('announcements GET:', e);
    return NextResponse.json(
      { error: 'Could not load announcements' },
      { status: 500 }
    );
  }
}
