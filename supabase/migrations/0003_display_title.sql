-- The name a client sees for a deliverable (event title, email subject line, post headline).
-- Kept apart from `title`, which mirrors the Notion "Notes" field and is rewritten on every sync.
alter table public.deliverables add column if not exists display_title text;
