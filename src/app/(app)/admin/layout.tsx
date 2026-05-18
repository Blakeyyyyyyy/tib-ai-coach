import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAppAdmin } from '@/lib/app-admin';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !(await isAppAdmin(supabase, user.id))) {
    redirect('/dashboard');
  }

  return children;
}
