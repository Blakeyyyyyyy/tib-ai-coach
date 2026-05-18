-- Migration: add_rag_calendar_news
-- Adds calendar_events and news_posts; adds profiles.tier.
-- Idempotent: safe to re-run

-- Add tier column to profiles (if migrating existing DB)
alter table public.profiles
  add column if not exists tier text not null default 'free'
  check (tier in ('free', 'paid'));

-- Calendar Events
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date timestamptz not null,
  location text,
  event_url text,
  is_featured boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add columns if table existed before without them
alter table public.calendar_events add column if not exists title text;
alter table public.calendar_events add column if not exists description text;
alter table public.calendar_events add column if not exists event_date timestamptz;
alter table public.calendar_events add column if not exists location text;
alter table public.calendar_events add column if not exists event_url text;
alter table public.calendar_events add column if not exists is_featured boolean not null default false;
alter table public.calendar_events add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.calendar_events add column if not exists created_at timestamptz not null default now();
alter table public.calendar_events add column if not exists updated_at timestamptz not null default now();

alter table public.calendar_events enable row level security;

drop policy if exists "Authenticated users can view calendar events" on public.calendar_events;
create policy "Authenticated users can view calendar events"
  on public.calendar_events for select
  using (auth.role() = 'authenticated');

drop policy if exists "Service role can manage calendar events" on public.calendar_events;
create policy "Service role can manage calendar events"
  on public.calendar_events for all
  using (auth.role() = 'service_role');

create index if not exists idx_calendar_events_date
  on public.calendar_events(event_date);

-- News / Updates Posts
create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  is_published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.news_posts add column if not exists title text;
alter table public.news_posts add column if not exists body text;
alter table public.news_posts add column if not exists image_url text;
alter table public.news_posts add column if not exists is_published boolean not null default true;
alter table public.news_posts add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.news_posts add column if not exists created_at timestamptz not null default now();
alter table public.news_posts add column if not exists updated_at timestamptz not null default now();

alter table public.news_posts enable row level security;

drop policy if exists "Authenticated users can view published news" on public.news_posts;
create policy "Authenticated users can view published news"
  on public.news_posts for select
  using (auth.role() = 'authenticated' and is_published = true);

drop policy if exists "Service role can manage news posts" on public.news_posts;
create policy "Service role can manage news posts"
  on public.news_posts for all
  using (auth.role() = 'service_role');

create index if not exists idx_news_posts_created_at
  on public.news_posts(created_at desc);
