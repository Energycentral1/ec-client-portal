-- Energy Central averages that client numbers are compared against.
-- Seeded from the media kit's "Benchmark Results" slide (Oct 2026); edit rows here to change what clients see.
create table if not exists public.benchmarks (
  deliverable_type text not null,
  metric text not null,              -- a metrics.metric name, or a rate: 'ctr', 'attendance'
  value numeric not null,            -- rates are fractions (0.009 = 0.9%)
  source text not null default 'media_kit',
  updated_at timestamptz not null default now(),
  primary key (deliverable_type, metric)
);
alter table public.benchmarks enable row level security;
create policy "benchmarks: read signed in" on public.benchmarks for select to authenticated using (true);
create policy "benchmarks: admin write" on public.benchmarks for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.benchmarks (deliverable_type, metric, value) values
  ('newsletter_ad', 'impressions', 28000), ('newsletter_ad', 'clicks', 250), ('newsletter_ad', 'ctr', 0.009),
  ('powersession', 'registrants', 230), ('powersession', 'attendance', 0.35),
  ('webinar', 'registrants', 215), ('webinar', 'attendance', 0.35),
  ('email_blast', 'opens', 35469), ('email_blast', 'clicks', 5568),
  ('podcast', 'plays', 307)
on conflict (deliverable_type, metric) do nothing;
