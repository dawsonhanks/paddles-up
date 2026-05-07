alter table public.challenges
  add column if not exists winner_id uuid references auth.users(id) on delete set null,
  add column if not exists challenger_score int4,
  add column if not exists challenged_score int4,
  add column if not exists score_submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists completed_at timestamptz;

do $$
declare
  rec record;
begin
  for rec in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'challenges'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.challenges drop constraint if exists %I', rec.conname);
  end loop;
end $$;

alter table public.challenges
  add constraint challenges_status_check
  check (status in ('pending', 'accepted', 'declined', 'score_submitted', 'completed'));

alter table public.matches
  add column if not exists challenge_id uuid references public.challenges(id) on delete cascade;

create index if not exists matches_challenge_id_idx on public.matches(challenge_id);
create index if not exists challenges_status_idx on public.challenges(status);

alter table public.challenges enable row level security;

drop policy if exists "challenges_update_participants" on public.challenges;
create policy "challenges_update_participants"
  on public.challenges for update
  to authenticated
  using (auth.uid() in (challenger_id, challenged_id))
  with check (auth.uid() in (challenger_id, challenged_id));

drop policy if exists "challenges_delete_participants" on public.challenges;
create policy "challenges_delete_participants"
  on public.challenges for delete
  to authenticated
  using (auth.uid() in (challenger_id, challenged_id));

drop policy if exists "matches_insert_own" on public.matches;
create policy "matches_insert_own"
  on public.matches for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or (
      challenge_id is not null
      and exists (
        select 1
        from public.challenges c
        where c.id = challenge_id
          and c.status = 'score_submitted'
          and auth.uid() in (c.challenger_id, c.challenged_id)
          and user_id in (c.challenger_id, c.challenged_id)
      )
    )
  );
