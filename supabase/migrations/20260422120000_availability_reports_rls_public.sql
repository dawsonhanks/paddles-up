-- Anonymous Expo sessions use the authenticated role with an anonymous user.
-- Replace permissive policies so both anon and authenticated can read/write reports.

alter table public.availability_reports enable row level security;

drop policy if exists "availability_reports_select_anon" on public.availability_reports;
drop policy if exists "availability_reports_insert_anon" on public.availability_reports;
drop policy if exists "availability_reports_select_public" on public.availability_reports;
drop policy if exists "availability_reports_insert_public" on public.availability_reports;

create policy "availability_reports_select_public"
  on public.availability_reports
  for select
  to anon, authenticated
  using (true);

create policy "availability_reports_insert_public"
  on public.availability_reports
  for insert
  to anon, authenticated
  with check (true);

grant select, insert on table public.availability_reports to anon, authenticated;
