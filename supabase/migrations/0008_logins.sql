-- Logins screen (/admin/logins): a removed login keeps its profile row (approvals point at it) but loses every right.
alter table public.profiles add column if not exists removed_at timestamptz;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and removed_at is null);
$$;

create or replace function public.my_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select client_id from public.profiles where id = auth.uid() and removed_at is null;
$$;
