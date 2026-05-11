-- Migration: seed_calendar_news
-- Adds sample calendar events and news posts so the pages have content to display.
-- Safe to run multiple times — uses unique titles to skip duplicates.

-- Sample Calendar Events
insert into public.calendar_events (title, description, event_date, location, event_url, is_featured)
select * from (values
  (
    'Cash Flow Masterclass — Live Workshop',
    'A 90-minute deep dive on managing cash flow during slow months. Real templates, real numbers, real fixes.',
    (now() + interval '5 days')::timestamptz,
    'Online (Zoom)',
    'https://tradeinbusiness.com/events/cashflow',
    true
  ),
  (
    'Pricing for Profit — Group Coaching',
    'Group session on how to price your jobs properly so you stop leaving money on the table.',
    (now() + interval '12 days')::timestamptz,
    'Online (Zoom)',
    'https://tradeinbusiness.com/events/pricing',
    false
  ),
  (
    'Hiring Your First Team Member',
    'Live Q&A covering recruitment, interviews, and onboarding a new tradie or apprentice.',
    (now() + interval '20 days')::timestamptz,
    'Online (Zoom)',
    'https://tradeinbusiness.com/events/hiring',
    false
  ),
  (
    'Quarterly Goal-Setting Session',
    'Set your next 90-day goals with Nicole. Limited spots, members only.',
    (now() + interval '35 days')::timestamptz,
    'Sydney, NSW',
    'https://tradeinbusiness.com/events/quarterly',
    true
  ),
  (
    'Systems & Automation Workshop',
    'Build the systems that let you take a day off without your business falling apart.',
    (now() + interval '50 days')::timestamptz,
    'Online (Zoom)',
    'https://tradeinbusiness.com/events/systems',
    false
  )
) as v(title, description, event_date, location, event_url, is_featured)
where not exists (
  select 1 from public.calendar_events ce where ce.title = v.title
);

-- Sample News Posts
insert into public.news_posts (title, body, is_published)
select * from (values
  (
    'Welcome to the TiB AI Coach',
    E'We''re excited to launch the TiB AI Coach — your 24/7 business coach in your pocket. Ask any question about running your trade business and get practical, no-nonsense advice based on years of coaching experience.\n\nThis is just the beginning — we''ll be adding more features, more content, and more ways to help you grow over the coming weeks.',
    true
  ),
  (
    'New Podcast Episode — Pricing for Profit',
    E'Our latest podcast episode is live. Nicole sits down with three tradies who turned around their pricing strategy in 60 days. One went from working 70-hour weeks to 45-hour weeks while increasing profit by 30%.\n\nListen in to learn the three pricing levers every trade business should be using.',
    true
  ),
  (
    'Members Only — Free Hiring Template Pack',
    E'We''ve just released a brand new template pack for our members. Includes job ads, interview scorecards, onboarding checklists, and a 90-day review template.\n\nIf you''re thinking about hiring in the next 6 months, grab this before your next interview.',
    true
  )
) as v(title, body, is_published)
where not exists (
  select 1 from public.news_posts np where np.title = v.title
);
