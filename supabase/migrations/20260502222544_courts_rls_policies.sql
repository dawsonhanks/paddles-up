-- Catalog table: readable by anon + authenticated (map, receptionist, favorites joins).
-- Inserts happen when moderation approves a court_submissions row (authenticated client).

alter table public.courts enable row level security;

-- Replace overlapping SELECT policies (ROLE public duplicated anon/authenticated).
drop policy if exists "Anyone can read courts" on public.courts;
drop policy if exists "courts select all" on public.courts;
drop policy if exists "courts insert authenticated" on public.courts;

create policy "courts_select_public"
  on public.courts
  for select
  to anon, authenticated
  using (true);

create policy "courts_insert_authenticated"
  on public.courts
  for insert
  to authenticated
  with check (true);

grant select on table public.courts to anon, authenticated;
grant insert on table public.courts to authenticated;
