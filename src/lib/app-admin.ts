import type { SupabaseClient } from '@supabase/supabase-js';

/** True when `user_id` exists in `app_admins` (configured in Supabase, not .env). */
export async function isAppAdmin(
  supabase: SupabaseClient,
  userId: string | undefined
): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await supabase
    .from('app_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return !error && data != null;
}
