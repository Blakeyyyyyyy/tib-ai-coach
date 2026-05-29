-- Run this entire file once in Supabase → SQL Editor.
-- Creates app_admins (if missing) + admin RLS for calendar, news, and announcements.

-- ----- 1. app_admins table -----

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

drop policy if exists "app_admins_select_own" on public.app_admins;
create policy "app_admins_select_own"
  on public.app_admins
  for select
  to authenticated
  using (user_id = auth.uid());

comment on table public.app_admins is 'Users allowed to manage admin content. Insert rows via SQL Editor only.';

-- ----- 2. announcements admin policies (if announcements table exists) -----

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'announcements'
  ) then
    drop policy if exists "announcements_select_as_admin" on public.announcements;
    create policy "announcements_select_as_admin"
      on public.announcements for select to authenticated
      using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

    drop policy if exists "announcements_insert_as_admin" on public.announcements;
    create policy "announcements_insert_as_admin"
      on public.announcements for insert to authenticated
      with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

    drop policy if exists "announcements_update_as_admin" on public.announcements;
    create policy "announcements_update_as_admin"
      on public.announcements for update to authenticated
      using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()))
      with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

    drop policy if exists "announcements_delete_as_admin" on public.announcements;
    create policy "announcements_delete_as_admin"
      on public.announcements for delete to authenticated
      using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));
  end if;
end $$;

-- ----- 3. calendar_events admin policies -----

drop policy if exists "calendar_events_select_as_admin" on public.calendar_events;
create policy "calendar_events_select_as_admin"
  on public.calendar_events for select to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

drop policy if exists "calendar_events_insert_as_admin" on public.calendar_events;
create policy "calendar_events_insert_as_admin"
  on public.calendar_events for insert to authenticated
  with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

drop policy if exists "calendar_events_update_as_admin" on public.calendar_events;
create policy "calendar_events_update_as_admin"
  on public.calendar_events for update to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

drop policy if exists "calendar_events_delete_as_admin" on public.calendar_events;
create policy "calendar_events_delete_as_admin"
  on public.calendar_events for delete to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

-- ----- 4. news_posts admin policies -----

drop policy if exists "news_posts_select_as_admin" on public.news_posts;
create policy "news_posts_select_as_admin"
  on public.news_posts for select to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

drop policy if exists "news_posts_insert_as_admin" on public.news_posts;
create policy "news_posts_insert_as_admin"
  on public.news_posts for insert to authenticated
  with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

drop policy if exists "news_posts_update_as_admin" on public.news_posts;
create policy "news_posts_update_as_admin"
  on public.news_posts for update to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

drop policy if exists "news_posts_delete_as_admin" on public.news_posts;
create policy "news_posts_delete_as_admin"
  on public.news_posts for delete to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));

-- ----- 5. Grant yourself admin (replace email, then run this line only) -----
-- insert into public.app_admins (user_id)
-- select id from auth.users where email = 'your-email@example.com' limit 1;
