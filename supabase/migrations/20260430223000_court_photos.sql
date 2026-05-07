-- Court photos: table + public storage bucket + RLS/storage policies

insert into storage.buckets (id, name, public)
values ('court-photos', 'court-photos', true)
on conflict (id) do update set public = true;

create table if not exists public.court_photos (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null,
  user_id uuid not null,
  photo_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists court_photos_court_created_idx
  on public.court_photos (court_id, created_at desc);

alter table public.court_photos enable row level security;

drop policy if exists "court_photos_select_public" on public.court_photos;
drop policy if exists "court_photos_insert_own" on public.court_photos;

create policy "court_photos_select_public"
  on public.court_photos
  for select
  to anon, authenticated
  using (true);

create policy "court_photos_insert_own"
  on public.court_photos
  for insert
  to authenticated
  with check (auth.uid() = user_id);

grant select on public.court_photos to anon, authenticated;
grant insert on public.court_photos to authenticated;

drop policy if exists "court_photos_bucket_select_public" on storage.objects;
drop policy if exists "court_photos_bucket_insert_own" on storage.objects;

create policy "court_photos_bucket_select_public"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'court-photos');

create policy "court_photos_bucket_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'court-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
