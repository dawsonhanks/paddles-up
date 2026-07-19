-- Allow the recipient of a pending friend request to insert BOTH mutual friendship rows:
--   (me → them) already allowed by "Users can insert friendships" (auth.uid() = user_id)
--   (them → me) needs this policy so accept can create a true mutual pair without a SECURITY DEFINER RPC.
-- Friendships SELECT/DELETE policies are unchanged.

drop policy if exists "friendships_insert_reciprocal_on_accept" on public.friendships;
create policy "friendships_insert_reciprocal_on_accept"
  on public.friendships
  for insert
  to authenticated
  with check (
    auth.uid() = friend_id
    and exists (
      select 1
      from public.friend_requests fr
      where fr.status = 'pending'
        and fr.from_user = friendships.user_id
        and fr.to_user = auth.uid()
    )
  );
