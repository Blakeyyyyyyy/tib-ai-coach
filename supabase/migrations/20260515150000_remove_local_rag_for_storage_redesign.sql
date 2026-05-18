-- Remove local-disk RAG stack before Storage-based RAG.
-- Run via `supabase db push` or paste into SQL Editor if migrations are not applied remotely.

drop function if exists public.match_knowledge_chunks(vector(1536), double precision, integer) cascade;
drop function if exists public.match_knowledge_chunks(vector, double precision, integer) cascade;

drop table if exists public.knowledge_chunks cascade;

alter table public.messages
  drop column if exists rag_sources;

drop extension if exists vector;
