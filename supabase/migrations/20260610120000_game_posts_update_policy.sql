-- Allow authors to edit their own game posts (required for Play tab "Save changes").
-- Without an UPDATE policy, Supabase returns success but updates zero rows.

drop policy if exists "Users can update own posts" on public.game_posts;

create policy "Users can update own posts"
  on public.game_posts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
