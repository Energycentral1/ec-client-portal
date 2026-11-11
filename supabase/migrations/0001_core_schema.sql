-- EC Client Portal: core schema v1
-- Clients see only their own rows (and only approved metrics). Admins see everything.
-- Data-pull jobs write with the service role key, which bypasses RLS.

create extension if not exists pgcrypto;

-- ============ TABLES ============

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  notion_partner_name text,          -- exact "Partner" value in Notion
  hubspot_company_id text,
  customer_report_sheet_url text,    -- legacy Google Sheet, for backfill
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'client' check (role in ('client', 'admin')),
  client_id uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  notion_page_id text unique,        -- [Master] Energy Central Campaigns
  name text not null,
  status text,
  date_signed date,
  am_name text,
  bp_name text,
  io_url text,
  wrap_report_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  notion_page_id text unique,        -- [Master] Energy Central Campaign Inventory row
  inventory_tag text unique,         -- EC-XXXX
  deliverable_type text not null check (deliverable_type in (
    'newsletter_ad', 'website_ad', 'email_blast', 'marketing_email',
    'webinar', 'powersession', 'podcast', 'featured_story', 'sponsored_article',
    'gated_content', 'non_gated_content', 'sponsorship', 'community_takeover',
    'linkedin_post', 'reel', 'other'
  )),
  deliverable_label text,            -- raw Notion "Deliverable" value(s)
  ec_brand text[],                   -- Daily, Weekly, EC Website, Power Perspectives...
  placement text,                    -- hero, spot_1 ... spot_5
  title text,
  start_date date,
  end_date date,
  status text,                       -- raw Notion status
  reporting_due_date date,           -- from SOP timing rules
  short_link text,
  short_link_id text,
  beehiiv_post_id text,
  zoom_event_id text,
  tally_form_id text,
  bettermode_post_id text,
  flightcast_episode text,
  youtube_video_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  metric text not null check (metric in (
    'impressions', 'opens', 'clicks', 'sent', 'delivered',
    'registrants', 'attendees', 'views', 'plays', 'short_form_views',
    'likes', 'comments', 'page_views'
  )),
  value numeric not null,
  window_start date,
  window_end date,
  source text not null check (source in (
    'beehiiv', 'shortio', 'zoom', 'tally', 'bettermode', 'youtube',
    'flightcast', 'linkedin', 'manual', 'legacy_sheet'
  )),
  status text not null default 'pending' check (status in ('pending', 'flagged', 'approved', 'rejected')),
  flag_reason text,
  pulled_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  unique (deliverable_id, metric, source, window_end)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  deliverable_id uuid references public.deliverables(id) on delete set null,
  source text not null check (source in ('webinar_live', 'webinar_on_demand', 'gated_content', 'survey', 'other')),
  email text not null,
  first_name text,
  last_name text,
  job_title text,
  company text,
  consent boolean,
  raw jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, deliverable_id, source, email)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  deliverable_id uuid references public.deliverables(id) on delete set null,
  kind text not null check (kind in ('screenshot', 'recording', 'replay_link', 'wrap_report', 'monthly_snapshot', 'creative', 'other')),
  title text,
  url text not null,
  created_at timestamptz not null default now()
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  records_written integer not null default 0,
  error text
);

create index on public.deliverables (client_id);
create index on public.deliverables (reporting_due_date);
create index on public.metrics (client_id, status);
create index on public.leads (client_id);
create index on public.assets (client_id);

-- ============ HELPERS ============

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select client_id from public.profiles where id = auth.uid();
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_clients_updated before update on public.clients for each row execute function public.set_updated_at();
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_campaigns_updated before update on public.campaigns for each row execute function public.set_updated_at();
create trigger trg_deliverables_updated before update on public.deliverables for each row execute function public.set_updated_at();

-- New auth user -> profile row (role defaults to client; an admin assigns client_id).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ ROW LEVEL SECURITY ============

alter table public.clients      enable row level security;
alter table public.profiles     enable row level security;
alter table public.campaigns    enable row level security;
alter table public.deliverables enable row level security;
alter table public.metrics      enable row level security;
alter table public.leads        enable row level security;
alter table public.assets       enable row level security;
alter table public.sync_runs    enable row level security;

-- clients
create policy "clients: read own or admin" on public.clients
  for select to authenticated using (public.is_admin() or id = public.my_client_id());
create policy "clients: admin write" on public.clients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles (clients can read themselves; only admins change roles / client assignment)
create policy "profiles: read self or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles: admin write" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- campaigns, deliverables, assets, leads: own client or admin
create policy "campaigns: read own or admin" on public.campaigns
  for select to authenticated using (public.is_admin() or client_id = public.my_client_id());
create policy "campaigns: admin write" on public.campaigns
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "deliverables: read own or admin" on public.deliverables
  for select to authenticated using (public.is_admin() or client_id = public.my_client_id());
create policy "deliverables: admin write" on public.deliverables
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "assets: read own or admin" on public.assets
  for select to authenticated using (public.is_admin() or client_id = public.my_client_id());
create policy "assets: admin write" on public.assets
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "leads: read own or admin" on public.leads
  for select to authenticated using (public.is_admin() or client_id = public.my_client_id());
create policy "leads: admin write" on public.leads
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- metrics: clients only ever see APPROVED numbers
create policy "metrics: read approved own or admin" on public.metrics
  for select to authenticated using (
    public.is_admin() or (client_id = public.my_client_id() and status = 'approved')
  );
create policy "metrics: admin write" on public.metrics
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- sync_runs: admin only
create policy "sync_runs: admin only" on public.sync_runs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
