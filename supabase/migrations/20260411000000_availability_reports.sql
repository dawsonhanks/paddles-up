-- Run in Supabase SQL editor or via CLI if you use migrations.
-- Matches lib/availability.ts insert shape.

create table if not exists public.availability_reports (
  id uuid primary key default gen_random_uuid(),
  court_id text not null,
  court_number int not null check (court_number >= 1),
  status text not null check (status in ('open', 'busy', 'full')),
  reporter_lat double precision not null,
  reporter_lng double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists availability_reports_court_created_idx
  on public.availability_reports (court_id, created_at desc);

alter table public.availability_reports enable row level security;

create policy "availability_reports_select_anon"
  on public.availability_reports for select
  using (true);

create policy "availability_reports_insert_anon"
  on public.availability_reports for insert
  with check (true);
