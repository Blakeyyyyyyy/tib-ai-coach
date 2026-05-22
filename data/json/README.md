# JSON files for RAG ingest

Paste your `.json` file(s) **in this folder**:

```
tib-ai-coach/data/json/
```

Full path on your machine:

```
C:\Users\HP\Documents\codeto\tib-ai-coach\data\json\
```

## What to put here

- One or more `.json` files (e.g. `knowledge.json`, `transcripts.json`)
- UTF-8 encoding
- Do **not** put secrets or API keys in these files

## Not in Supabase Storage

PDFs for the coach use the **Rag** Storage bucket (`npm run ingest:storage`).

JSON in this folder is for a **separate local ingest** step (to be wired to `knowledge_chunks`).

## After you paste

Tell us the file name and a sample of the structure (first object in the array), so we can add `npm run ingest:json` to chunk and embed it like the PDFs.
