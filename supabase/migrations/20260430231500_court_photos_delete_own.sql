-- Allow authenticated users to delete their own court photo rows and storage objects.

drop policy if exists "court_photos_delete_own" on public.court_photos;

create policy "court_photos_delete_own"
  on public.court_photos
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant delete on public.court_photos to authenticated;

drop policy if exists "court_photos_bucket_delete_own" on storage.objects;

create policy "court_photos_bucket_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'court-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
