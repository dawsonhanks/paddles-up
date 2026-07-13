-- Historical court occupancy: append-only events + daily rollups for Cody's dashboard.
-- Does not modify existing tables or their RLS policies.

-- ---------------------------------------------------------------------------
-- a) court_status_events
-- ---------------------------------------------------------------------------

create table if not exists public.court_status_events (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id),
  zone_id uuid references public.zones (id),
  status text not null check (status in ('available', 'busy', 'unknown')),
  source text not null check (source in ('sensor', 'checkin', 'zone_report', 'manual')),
  occurred_at timestamptz not null default now()
);

create index if not exists court_status_events_court_occurred_idx
  on public.court_status_events (court_id, occurred_at);

create index if not exists court_status_events_zone_occurred_idx
  on public.court_status_events (zone_id, occurred_at)
  where zone_id is not null;

-- ---------------------------------------------------------------------------
-- b) court_usage_daily
-- ---------------------------------------------------------------------------

create table if not exists public.court_usage_daily (
  court_id uuid not null references public.courts (id),
  usage_date date not null,
  busy_minutes int not null default 0,
  checkin_count int not null default 0,
  unique_users int not null default 0,
  peak_hour int check (peak_hour is null or (peak_hour >= 0 and peak_hour <= 23)),
  primary key (court_id, usage_date)
);

-- ---------------------------------------------------------------------------
-- c) Views
-- ---------------------------------------------------------------------------

create or replace view public.court_usage_hourly
with (security_invoker = true)
as
select
  court_id,
  date_trunc('hour', occurred_at) as hour_bucket,
  count(*) filter (where status = 'busy') as busy_transitions
from public.court_status_events
group by court_id, date_trunc('hour', occurred_at);

create or replace view public.court_current_status
with (security_invoker = true)
as
select distinct on (court_id)
  id,
  court_id,
  zone_id,
  status,
  source,
  occurred_at
from public.court_status_events
order by court_id, occurred_at desc;

-- ---------------------------------------------------------------------------
-- d) RLS — SELECT-only for anon on new tables and views
-- ---------------------------------------------------------------------------

alter table public.court_status_events enable row level security;
alter table public.court_usage_daily enable row level security;

grant select on table public.court_status_events to anon, authenticated;
grant select on table public.court_usage_daily to anon, authenticated;
grant select on public.court_usage_hourly to anon, authenticated;
grant select on public.court_current_status to anon, authenticated;

drop policy if exists "court_status_events_select_anon" on public.court_status_events;
create policy "court_status_events_select_anon"
  on public.court_status_events
  for select
  to anon
  using (true);

drop policy if exists "court_usage_daily_select_anon" on public.court_usage_daily;
create policy "court_usage_daily_select_anon"
  on public.court_usage_daily
  for select
  to anon
  using (true);

-- ---------------------------------------------------------------------------
-- e) log_zone_report_event trigger
-- ---------------------------------------------------------------------------

create or replace function public.log_zone_report_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.court_status_events (
    court_id,
    zone_id,
    status,
    source,
    occurred_at
  )
  values (
    new.court_id,
    new.zone_id,
    case when new.status = 'busy' then 'busy' else 'available' end,
    'zone_report',
    new.reported_at
  );

  return new;
end;
$$;

alter function public.log_zone_report_event() owner to postgres;

drop trigger if exists zone_reports_log_status_event on public.zone_reports;
create trigger zone_reports_log_status_event
after insert on public.zone_reports
for each row execute function public.log_zone_report_event();

-- ---------------------------------------------------------------------------
-- f) log_checkin_event trigger
-- ---------------------------------------------------------------------------

create or replace function public.log_checkin_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.court_id is null then
    return new;
  end if;

  insert into public.court_status_events (
    court_id,
    status,
    source,
    occurred_at
  )
  values (
    new.court_id,
    'busy',
    'checkin',
    coalesce(new.checked_in_at, now())
  );

  return new;
end;
$$;

alter function public.log_checkin_event() owner to postgres;

drop trigger if exists court_checkins_log_status_event on public.court_checkins;
create trigger court_checkins_log_status_event
after insert on public.court_checkins
for each row execute function public.log_checkin_event();

-- ---------------------------------------------------------------------------
-- Denver "yesterday" window for nightly rollup (service role only)
-- ---------------------------------------------------------------------------

create or replace function public.court_usage_denver_yesterday_window()
returns table (
  usage_date date,
  day_start timestamptz,
  day_end timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select (timezone('America/Denver', now()))::date as today_denver
  )
  select
    today_denver - 1,
    ((today_denver - 1)::timestamp at time zone 'America/Denver'),
    (today_denver::timestamp at time zone 'America/Denver')
  from d;
$$;

alter function public.court_usage_denver_yesterday_window() owner to postgres;
revoke all on function public.court_usage_denver_yesterday_window() from public;
grant execute on function public.court_usage_denver_yesterday_window() to service_role;

-- ---------------------------------------------------------------------------
-- pg_cron: nightly rollup-daily-usage at 2am America/Denver
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Inline anon key (ALTER DATABASE app.settings.anon_key fails on hosted Supabase).
-- 08:00 UTC = 02:00 America/Denver during MDT (Mar–Nov); 01:00 MST during standard time.
select cron.schedule(
  'rollup-daily-usage',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://pjpkrctqsekwhzhmdpmv.supabase.co/functions/v1/rollup-daily-usage',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqcGtyY3Rxc2Vrd2h6aG1kcG12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MzU1MDUsImV4cCI6MjA5MTExMTUwNX0.ee30V4pjNw-I_CQszQl6xCoQ0j3Fv9QEL5IE3vyqGIY'
    )
  );
  $$
);

-- Helper: check recent cron job runs
-- select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'rollup-daily-usage') order by start_time desc limit 5;

-- Helper: unschedule later if needed
-- select cron.unschedule('rollup-daily-usage');
