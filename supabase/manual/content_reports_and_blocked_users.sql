-- Paste into Supabase SQL Editor (idempotent). Mirrors migration 20260513180000_content_reports_blocked_users.sql.

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  content_type text not null check (content_type in ('post', 'review', 'message', 'profile')),
  content_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists content_reports_created_at_idx on public.content_reports (created_at desc);
create index if not exists content_reports_content_idx on public.content_reports (content_type, content_id);

alter table public.content_reports enable row level security;

drop policy if exists "content_reports insert own" on public.content_reports;
create policy "content_reports insert own"
  on public.content_reports
  for insert
  to authenticated, anon
  with check (auth.uid() = reporter_id);

drop policy if exists "content_reports select authenticated" on public.content_reports;
create policy "content_reports select authenticated"
  on public.content_reports
  for select
  to authenticated, anon
  using (true);

create table if not exists public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists blocked_users_blocker_idx on public.blocked_users (blocker_id);

alter table public.blocked_users enable row level security;

drop policy if exists "blocked_users insert own" on public.blocked_users;
create policy "blocked_users insert own"
  on public.blocked_users
  for insert
  to authenticated, anon
  with check (auth.uid() = blocker_id);

drop policy if exists "blocked_users select own" on public.blocked_users;
create policy "blocked_users select own"
  on public.blocked_users
  for select
  to authenticated, anon
  using (auth.uid() = blocker_id);

drop policy if exists "blocked_users delete own" on public.blocked_users;
create policy "blocked_users delete own"
  on public.blocked_users
  for delete
  to authenticated, anon
  using (auth.uid() = blocker_id);
