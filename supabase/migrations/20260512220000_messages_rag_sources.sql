-- Legacy slot: previously added messages.rag_sources (removed).
-- No-op so migration history stays aligned; column is dropped in 20260513200000_remove_wp_pgvector_rag.sql if present.
select 1;
