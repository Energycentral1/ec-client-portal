-- Lead details clients filter and export on, and what a CRM push needs.
alter table public.leads
  add column if not exists attended boolean,          -- live events: true = attended, false = registered only; null elsewhere
  add column if not exists phone text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text,
  add column if not exists company_size text,
  add column if not exists origin text not null default 'manual'
    check (origin in ('zoom', 'tally', 'legacy_sheet', 'manual')),  -- which system the row came from
  add column if not exists crm_pushed_at timestamptz;  -- set when the lead has been sent to the client's CRM

create index if not exists leads_deliverable_idx on public.leads (deliverable_id);
