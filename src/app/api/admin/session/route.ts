import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppAdmin } from '@/lib/app-admin';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin =
    user?.id != null ? await isAppAdmin(supabase, user.id) : false;
  return NextResponse.json({ isAdmin: admin });
}
