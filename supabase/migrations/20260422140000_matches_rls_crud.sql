-- Allow users to read/update/delete their own match rows (required for match detail screen).
-- Anonymous sign-in still uses the authenticated role in Supabase.

alter table public.matches enable row level security;

drop policy if exists "matches_select_own" on public.matches;
drop policy if exists "matches_insert_own" on public.matches;
drop policy if exists "matches_update_own" on public.matches;
drop policy if exists "matches_delete_own" on public.matches;

create policy "matches_select_own"
  on public.matches for select
  to authenticated
  using (auth.uid() = user_id);

create policy "matches_insert_own"
  on public.matches for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "matches_update_own"
  on public.matches for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "matches_delete_own"
  on public.matches for delete
  to authenticated
  using (auth.uid() = user_id);
