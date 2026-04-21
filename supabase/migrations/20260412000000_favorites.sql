-- Favorites per authenticated user (including anonymous users).
-- Enable Authentication → Providers → Anonymous sign-ins in Supabase for the app to create a session.

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  court_id text not null,
  saved_at timestamptz not null default now(),
  unique (user_id, court_id)
);

create index if not exists favorites_user_id_idx on public.favorites (user_id);
create index if not exists favorites_court_id_idx on public.favorites (court_id);

alter table public.favorites enable row level security;

create policy "favorites_select_own"
  on public.favorites for select
  using (auth.uid() = user_id);

create policy "favorites_insert_own"
  on public.favorites for insert
  with check (auth.uid() = user_id);

create policy "favorites_delete_own"
  on public.favorites for delete
  using (auth.uid() = user_id);
