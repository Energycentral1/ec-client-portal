-- Links: every deliverable can point at where it ran, and newsletter ads link to that day's issue.

-- Where a client can see the deliverable live (event page, Partner Content post, email web version...).
alter table public.deliverables add column if not exists live_url text;

-- One row per newsletter send. Newsletter ads join to it on publication + date, so a single pull
-- gives every advertiser in that issue both the link and (later) the opens used as impressions.
create table if not exists public.newsletter_issues (
  id uuid primary key default gen_random_uuid(),
  publication text not null check (publication in ('daily', 'weekly', 'marketing')),
  issue_date date not null,
  title text,
  web_url text,
  beehiiv_post_id text unique,
  sent_at timestamptz,
  total_opens integer,
  unique_opens integer,
  recipients integer,
  pulled_at timestamptz not null default now(),
  unique (publication, issue_date)
);

alter table public.newsletter_issues enable row level security;

drop policy if exists "newsletter_issues: read signed in" on public.newsletter_issues;
create policy "newsletter_issues: read signed in" on public.newsletter_issues
  for select to authenticated using (true);
drop policy if exists "newsletter_issues: admin write" on public.newsletter_issues;
create policy "newsletter_issues: admin write" on public.newsletter_issues
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
