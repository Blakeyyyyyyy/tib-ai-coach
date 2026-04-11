# TiB AI Coach — Setup Tasks

Come back to this file when you're ready to connect everything.
Give these values to Claude and it'll wire them in for you.

---

## 1. Create a Supabase Project

- Go to https://supabase.com and create a new project
- Once created, go to **Settings → API** and grab:

```
NEXT_PUBLIC_SUPABASE_URL = ___________
NEXT_PUBLIC_SUPABASE_ANON_KEY = ___________
```

---

## 2. Run the Database Schema

- In your Supabase project, go to **SQL Editor**
- Paste the contents of `supabase-schema.sql` (in the project root) and run it
- This creates all 5 tables with row-level security

---

## 3. Get a Claude API Key

- Go to https://console.anthropic.com
- Create an API key (or use an existing one)

```
ANTHROPIC_API_KEY = ___________
```

---

## 4. Give the values to Claude

Once you have all three values, just paste them here like:

> Here are my keys:
> - Supabase URL: https://xxxx.supabase.co
> - Supabase Anon Key: eyJhbG...
> - Anthropic API Key: sk-ant-...

Claude will update `.env.local` and you're live.

---

## Quick Reference

| What | Where |
|------|-------|
| App | http://localhost:3000 |
| Dashboard | http://localhost:3000/dashboard |
| AI Coach | http://localhost:3000/coach |
| Tasks | http://localhost:3000/tasks |
| Login | http://localhost:3000/login |
| Sign Up | http://localhost:3000/signup |
| DB Schema | `supabase-schema.sql` |
| Env Config | `.env.local` |
