-- Friends can view each other's match history (needed for Friend profile recent matches).

create policy "matches_select_friend"
  on public.matches for select
  to authenticated
  using (
    exists (
      select 1
      from public.friendships f
      where f.user_id = (select auth.uid())
        and f.friend_id = matches.user_id
    )
  );
