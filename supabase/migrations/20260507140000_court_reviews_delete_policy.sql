grant delete on table public.court_reviews to authenticated;

drop policy if exists "court_reviews_delete_own" on public.court_reviews;

create policy "court_reviews_delete_own"
  on public.court_reviews for delete to authenticated
  using (auth.uid() = user_id);
