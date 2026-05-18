-- Local PDF RAG: pgvector + knowledge_chunks + similarity RPC + assistant citations.

create extension if not exists vector;

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536),
  source_title text not null,
  source_url text,
  resource_url text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.knowledge_chunks enable row level security;

drop policy if exists "Authenticated read knowledge chunks" on public.knowledge_chunks;
create policy "Authenticated read knowledge chunks"
  on public.knowledge_chunks for select
  using (auth.role() = 'authenticated');

drop policy if exists "Service role can manage knowledge chunks" on public.knowledge_chunks;
create policy "Service role can manage knowledge chunks"
  on public.knowledge_chunks for all
  using (auth.role() = 'service_role');

drop index if exists public.idx_knowledge_chunks_embedding;
create index idx_knowledge_chunks_embedding
  on public.knowledge_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists idx_knowledge_chunks_filename
  on public.knowledge_chunks ((metadata ->> 'filename'));

create or replace function public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.35,
  match_count int default 24
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
    k.id,
    k.content,
    k.source_title,
    k.source_url,
    k.resource_url,
    k.metadata,
    1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks k
  where k.embedding is not null
    and 1 - (k.embedding <=> query_embedding) > match_threshold
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_knowledge_chunks(vector, double precision, integer)
  to authenticated;

alter table public.messages
  add column if not exists rag_sources jsonb;
