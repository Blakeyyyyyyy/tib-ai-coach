-- Rolling summary for long coach threads (generation only; RAG stays query-focused).

alter table public.conversations
  add column if not exists memory_summary text,
  add column if not exists summary_updated_at timestamptz;

comment on column public.conversations.memory_summary is
  'Factual rolling summary of older turns; recent messages sent verbatim to the coach.';
