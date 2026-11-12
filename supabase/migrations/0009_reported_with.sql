-- Old reports often give one number for several Notion rows (a week of daily newsletter ads, or Hero + 1st Spot on one day).
-- The number is stored on one placement; the others point at it here so pulls skip them and they don't count as missing.
alter table public.deliverables add column if not exists reported_with uuid references public.deliverables(id) on delete set null;
