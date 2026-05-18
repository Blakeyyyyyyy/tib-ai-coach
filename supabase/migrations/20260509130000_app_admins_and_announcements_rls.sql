-- App admins are stored in Supabase (no ADMIN_EMAILS / service role needed for announcements).
-- After running this, add yourself once in SQL Editor (see bottom).

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

-- Logged-in users can only read their own row (to verify admin + sidebar).
create policy "app_admins_select_own"
  on public.app_admins
  for select
  to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete via the anon key — add/remove admins only in the SQL Editor (as postgres).

-- ----- Announcements: let app admins manage all rows using their normal session (JWT) -----

-- Admins can see every row (drafts + scheduling).
create policy "announcements_select_as_admin"
  on public.announcements
  for select
  to authenticated
  using (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

create policy "announcements_insert_as_admin"
  on public.announcements
  for insert
  to authenticated
  with check (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

create policy "announcements_update_as_admin"
  on public.announcements
  for update
  to authenticated
  using (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

create policy "announcements_delete_as_admin"
  on public.announcements
  for delete
  to authenticated
  using (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

comment on table public.app_admins is 'Users allowed to manage announcements. Insert rows via SQL Editor only.';

-- --- One-time: grant yourself admin (replace email) ---
-- insert into public.app_admins (user_id)
-- select id from auth.users where email = 'your-login@email.com' limit 1;
