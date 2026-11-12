-- Creative proofs: the ad as it will run, tied to the placement, approved by the client in the portal.
create table if not exists public.proofs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  deliverable_id uuid references public.deliverables(id) on delete set null,
  name text not null,
  copy_text text,            -- the ad copy as it will run (text ads have no image)
  click_url text,            -- where the ad clicks through to; clients check this as much as the image
  note text,                 -- from Energy Central to the client
  file_path text,            -- object in the private 'proofs' storage bucket: <client_id>/<uuid>-<filename>
  link_url text,             -- or a link to the creative (Figma, Drive, Canva)
  due_date date,             -- approve by; defaults to 3 days before the placement runs
  status text not null default 'awaiting_review' check (status in ('awaiting_review', 'changes_requested', 'approved')),
  feedback text,
  reviewed_by uuid references public.profiles(id),
  reviewed_by_email text,
  reviewed_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (file_path is not null or link_url is not null or copy_text is not null)
);
create index if not exists proofs_client_idx on public.proofs (client_id, created_at desc);
alter table public.proofs enable row level security;
create policy "proofs: read own or admin" on public.proofs for select to authenticated using (public.is_admin() or client_id = public.my_client_id());
create policy "proofs: admin write" on public.proofs for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Clients can't write to proofs directly; this is the only thing they can do: approve or ask for changes on their own proofs.
create or replace function public.review_proof(p_id uuid, p_decision text, p_feedback text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_decision not in ('approved', 'changes_requested', 'awaiting_review') then raise exception 'Unknown decision'; end if;
  if p_decision = 'awaiting_review' and not public.is_admin() then raise exception 'Admins only'; end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_feedback), '') = '' then raise exception 'Say what should change'; end if;
  if not (public.is_admin() or exists (select 1 from public.proofs where id = p_id and client_id = public.my_client_id())) then
    raise exception 'Not your proof';
  end if;
  update public.proofs set status = p_decision,
    feedback = case when p_decision = 'awaiting_review' then null else nullif(trim(coalesce(p_feedback, '')), '') end,
    reviewed_by = case when p_decision = 'awaiting_review' then null else auth.uid() end,
    reviewed_by_email = case when p_decision = 'awaiting_review' then null else (select email from public.profiles where id = auth.uid()) end,
    reviewed_at = case when p_decision = 'awaiting_review' then null else now() end
  where id = p_id;
end;
$$;
revoke all on function public.review_proof(uuid, text, text) from public, anon;
grant execute on function public.review_proof(uuid, text, text) to authenticated;

insert into storage.buckets (id, name, public) values ('proofs', 'proofs', false) on conflict (id) do nothing;
create policy "proof files: read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and (public.is_admin() or (storage.foldername(name))[1] = public.my_client_id()::text));
create policy "proof files: admin write" on storage.objects for all to authenticated
  using (bucket_id = 'proofs' and public.is_admin()) with check (bucket_id = 'proofs' and public.is_admin());
