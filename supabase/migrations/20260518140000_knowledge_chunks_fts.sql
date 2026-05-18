-- Full-text search on knowledge_chunks (complements pgvector + phrase ILIKE).

create index if not exists idx_knowledge_chunks_content_fts
  on public.knowledge_chunks
  using gin (
    to_tsvector(
      'english',
      coalesce(source_title, '') || ' ' || coalesce(content, '')
    )
  );

create or replace function public.search_knowledge_chunks_fts(
  search_query text,
  match_count int default 15
)
returns table (
  id uuid,
  content text,
  source_title text,
  source_url text,
  resource_url text,
  metadata jsonb,
  rank real
)
language sql stable
as $$
  with q as (
    select websearch_to_tsquery('english', search_query) as tsq
  )
  select
    k.id,
    k.content,
    k.source_title,
    k.source_url,
    k.resource_url,
    k.metadata,
    ts_rank_cd(
      to_tsvector(
        'english',
        coalesce(k.source_title, '') || ' ' || coalesce(k.content, '')
      ),
      q.tsq
    )::real as rank
  from public.knowledge_chunks k
  cross join q
  where btrim(search_query) <> ''
    and q.tsq is not null
    and to_tsvector(
      'english',
      coalesce(k.source_title, '') || ' ' || coalesce(k.content, '')
    ) @@ q.tsq
  order by rank desc
  limit greatest(match_count, 1);
$$;

grant execute on function public.search_knowledge_chunks_fts(text, int)
  to service_role;
