-- Remove legacy pgvector RAG objects if they still exist (from older DBs / old migration runs).
-- Safe on fresh installs (no-op). New installs never create knowledge_chunks (see 20260508174739).
-- When you add a new PDF pipeline, include: create extension if not exists vector;

drop function if exists public.match_knowledge_chunks(vector(1536), double precision, integer) cascade;
drop function if exists public.match_knowledge_chunks(vector, double precision, integer) cascade;

drop table if exists public.knowledge_chunks cascade;

alter table public.messages
  drop column if exists rag_sources;

drop extension if exists vector;
