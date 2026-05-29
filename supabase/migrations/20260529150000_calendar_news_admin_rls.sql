-- Let app admins manage calendar_events and news_posts via normal JWT session.
-- Requires public.app_admins (run supabase/setup-admin-access.sql if missing).

-- ----- calendar_events -----

drop policy if exists "calendar_events_select_as_admin" on public.calendar_events;
create policy "calendar_events_select_as_admin"
  on public.calendar_events
  for select
  to authenticated
  using (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

drop policy if exists "calendar_events_insert_as_admin" on public.calendar_events;
create policy "calendar_events_insert_as_admin"
  on public.calendar_events
  for insert
  to authenticated
  with check (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

drop policy if exists "calendar_events_update_as_admin" on public.calendar_events;
create policy "calendar_events_update_as_admin"
  on public.calendar_events
  for update
  to authenticated
  using (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

drop policy if exists "calendar_events_delete_as_admin" on public.calendar_events;
create policy "calendar_events_delete_as_admin"
  on public.calendar_events
  for delete
  to authenticated
  using (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

-- ----- news_posts -----

drop policy if exists "news_posts_select_as_admin" on public.news_posts;
create policy "news_posts_select_as_admin"
  on public.news_posts
  for select
  to authenticated
  using (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

drop policy if exists "news_posts_insert_as_admin" on public.news_posts;
create policy "news_posts_insert_as_admin"
  on public.news_posts
  for insert
  to authenticated
  with check (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

drop policy if exists "news_posts_update_as_admin" on public.news_posts;
create policy "news_posts_update_as_admin"
  on public.news_posts
  for update
  to authenticated
  using (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );

drop policy if exists "news_posts_delete_as_admin" on public.news_posts;
create policy "news_posts_delete_as_admin"
  on public.news_posts
  for delete
  to authenticated
  using (
    exists (select 1 from public.app_admins a where a.user_id = auth.uid())
  );
