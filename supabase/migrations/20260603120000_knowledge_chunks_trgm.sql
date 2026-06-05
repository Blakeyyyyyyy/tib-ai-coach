-- Trigram index for fast ILIKE / phrase search on chunk content.

create extension if not exists pg_trgm;

create index if not exists idx_knowledge_chunks_content_trgm
  on public.knowledge_chunks
  using gin (content gin_trgm_ops);
