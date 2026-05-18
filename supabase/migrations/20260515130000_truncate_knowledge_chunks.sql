-- Full wipe of knowledge_chunks (all embeddings + chunk text).
-- Use once after moving from WordPress ingest to local PDFs only, or whenever the table
-- still contains old rows because `create table if not exists` kept the table and data.
-- After this runs, run: npm run ingest:local

do $body$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'knowledge_chunks'
  ) then
    execute 'truncate table public.knowledge_chunks';
  end if;
end
$body$;
