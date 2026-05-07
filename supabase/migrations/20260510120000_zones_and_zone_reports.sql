-- Venue sub-areas for optional zone-level open/busy hints (secondary to check-ins).

create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  zone_name text not null,
  display_order int4 not null default 0
);

create index if not exists zones_court_id_idx on public.zones (court_id);

alter table public.zones enable row level security;

drop policy if exists "zones_select_public" on public.zones;
create policy "zones_select_public"
  on public.zones for select
  using (true);

grant select on table public.zones to anon, authenticated;

-- Player-submitted zone status; 30 min TTL (app sets expires_at).

create table if not exists public.zone_reports (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status = any (array['open'::text, 'busy'::text])),
  reported_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists zone_reports_court_expires_idx
  on public.zone_reports (court_id, expires_at desc);

create index if not exists zone_reports_zone_reported_idx
  on public.zone_reports (zone_id, reported_at desc);

alter table public.zone_reports enable row level security;

drop policy if exists "zone_reports_select_public" on public.zone_reports;
create policy "zone_reports_select_public"
  on public.zone_reports for select
  using (true);

drop policy if exists "zone_reports_insert_own" on public.zone_reports;
create policy "zone_reports_insert_own"
  on public.zone_reports for insert
  with check (auth.uid() = user_id);

grant select, insert on table public.zone_reports to anon, authenticated;

-- Seed zones for large venues (idempotent — skip courts that already have rows).

insert into public.zones (court_id, zone_name, display_order)
select c.id, v.zone_name, v.ord
from public.courts c
cross join (
  select * from (
    values
      ('Left side'::text, 0),
      ('Right side', 1)
  ) s(zone_name, ord)
) v
where c.num_courts >= 4
  and c.num_courts < 6
  and not exists (select 1 from public.zones z where z.court_id = c.id);

insert into public.zones (court_id, zone_name, display_order)
select c.id, v.zone_name, v.ord
from public.courts c
cross join (
  select * from (
    values
      ('Left side'::text, 0),
      ('Middle', 1),
      ('Right side', 2)
  ) s(zone_name, ord)
) v
where c.num_courts >= 6
  and not exists (select 1 from public.zones z where z.court_id = c.id);
