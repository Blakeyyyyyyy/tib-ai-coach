-- Migration: add_rag_calendar_news
-- Adds knowledge_chunks (RAG), calendar_events, and news_posts tables
-- Also adds tier column to profiles if not already present
-- Idempotent: safe to re-run

-- Enable pgvector extension for RAG embeddings
create extension if not exists vector;

-- Add tier column to profiles (if migrating existing DB)
alter table public.profiles
  add column if not exists tier text not null default 'free'
  check (tier in ('free', 'paid'));

-- Knowledge Chunks (RAG knowledge base)
create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536),
  source_title text not null,
  source_url text,
  resource_url text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

alter table public.knowledge_chunks enable row level security;

drop policy if exists "Anyone can read knowledge chunks" on public.knowledge_chunks;
create policy "Anyone can read knowledge chunks"
  on public.knowledge_chunks for select
  using (true);

drop policy if exists "Service role can manage knowledge chunks" on public.knowledge_chunks;
create policy "Service role can manage knowledge chunks"
  on public.knowledge_chunks for all
  using (auth.role() = 'service_role');

create index if not exists idx_knowledge_chunks_embedding
  on public.knowledge_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

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

-- Function for vector similarity search (used by RAG retrieval)
create or replace function match_knowledge_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  source_title text,
  source_url text,
  resource_url text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    id,
    content,
    source_title,
    source_url,
    resource_url,
    metadata,
    1 - (embedding <=> query_embedding) as similarity
  from public.knowledge_chunks
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
