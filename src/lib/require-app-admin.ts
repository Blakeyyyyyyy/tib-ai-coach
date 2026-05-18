import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppAdmin } from '@/lib/app-admin';

export async function requireAppAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!(await isAppAdmin(supabase, user.id))) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { supabase, user };
}
