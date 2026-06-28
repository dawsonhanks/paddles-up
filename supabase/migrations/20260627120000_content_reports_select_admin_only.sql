-- Restrict content_reports reads to admins; reporters can still INSERT.
drop policy if exists "content_reports select authenticated" on public.content_reports;

create policy "content_reports select admin"
  on public.content_reports
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.players p
      where p.user_id = (select auth.uid())
        and coalesce(p.admin, false)
    )
  );
