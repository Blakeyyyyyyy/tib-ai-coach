-- Legacy slot: previously granted execute on match_knowledge_chunks (removed).
-- No-op so migration history stays aligned; embedding RPC/table are dropped in 20260513200000_remove_wp_pgvector_rag.sql.
select 1;
