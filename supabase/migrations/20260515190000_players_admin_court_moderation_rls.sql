-- players.admin: gate court moderation and catalog inserts (see court_submissions + courts RLS below).
alter table public.players
  add column if not exists admin boolean not null default false;

comment on column public.players.admin is 'When true, user may moderate court_submissions and insert into courts. Mutable only via service role.';

-- Clients cannot grant themselves admin; Dashboard / service_role can set the flag.
create or replace function public.players_enforce_admin_mutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select auth.role()) = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.admin := false;
  elsif tg_op = 'UPDATE' then
    new.admin := old.admin;
  end if;

  return new;
end;
$$;

drop trigger if exists players_enforce_admin_mutability on public.players;

create trigger players_enforce_admin_mutability
  before insert or update on public.players
  for each row
  execute function public.players_enforce_admin_mutability();

-- Court submissions: anyone may still insert suggestions; only admins see/update the pending queue.
drop policy if exists "court submissions select pending for moderation" on public.court_submissions;
drop policy if exists "court submissions update for moderation" on public.court_submissions;

create policy "court submissions select pending for moderation"
  on public.court_submissions
  for select
  to authenticated
  using (
    status = 'pending'
    and exists (
      select 1
      from public.players p
      where p.user_id = (select auth.uid())
        and coalesce(p.admin, false)
    )
  );

create policy "court submissions update for moderation"
  on public.court_submissions
  for update
  to authenticated
  using (
    status = 'pending'
    and exists (
      select 1
      from public.players p
      where p.user_id = (select auth.uid())
        and coalesce(p.admin, false)
    )
  )
  with check (status in ('approved', 'rejected'));

-- Catalog courts: only admins may insert (approve flow). Public read unchanged.
drop policy if exists "courts_insert_authenticated" on public.courts;

create policy "courts_insert_admin"
  on public.courts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.players p
      where p.user_id = (select auth.uid())
        and coalesce(p.admin, false)
    )
  );
