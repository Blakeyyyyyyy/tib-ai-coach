-- Site announcements / events shown as in-app popups for authenticated users.
-- Run this in the Supabase SQL Editor (or via CLI) against your project.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  tag text not null default 'Event',
  title text not null,
  summary text,
  description text,
  event_date timestamptz,
  published boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_active_idx
  on public.announcements (published, starts_at, ends_at, created_at desc);

alter table public.announcements enable row level security;

-- Logged-in users only see rows that are published and within the visible window.
create policy "announcements_select_published"
  on public.announcements
  for select
  to authenticated
  using (
    published = true
    and coalesce(starts_at, created_at) <= now()
    and (ends_at is null or ends_at >= now())
  );

-- Inserts/updates/deletes for admins are handled by migration 20260509130000_app_admins_and_announcements_rls.sql (JWT + app_admins).

comment on table public.announcements is 'Marketing/events popups; admins manage rows via app session (see app_admins table).';

-- Optional: instant “push” when an admin publishes while users are online —
-- In Supabase Dashboard → Database → Replication, enable Realtime for table `announcements`,
-- or run:
--   alter table public.announcements replica identity full;
--   alter publication supabase_realtime add table public.announcements;

create or replace function public.set_announcements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
  before update on public.announcements
  for each row
  execute procedure public.set_announcements_updated_at();
