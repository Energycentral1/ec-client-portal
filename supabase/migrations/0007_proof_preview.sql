-- Show creative the way it will run: the linked call-to-action text, and which layout to preview it in.
alter table public.proofs
  add column if not exists cta_text text,   -- the linked words at the end of a newsletter ad ("Run your numbers today")
  add column if not exists format text check (format in ('newsletter_ad', 'newsletter_hero', 'plain'));  -- null = work it out from the placement
