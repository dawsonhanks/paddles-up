-- Daily check-in streaks (one row per user). Updated by trigger on court_checkins.
-- Trigger runs AFTER INSERT OR UPDATE OF checked_in_at so repeat check-ins (upsert updates) still advance streaks.

create table if not exists public.streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  current_streak int4 not null default 0,
  longest_streak int4 not null default 0,
  last_checkin_date date,
  milestone_celebrated text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists streaks_user_id_idx on public.streaks (user_id);

alter table public.streaks enable row level security;

grant select, update on table public.streaks to anon, authenticated;

drop policy if exists "streaks_select_own" on public.streaks;
create policy "streaks_select_own"
  on public.streaks for select
  using (auth.uid() = user_id);

drop policy if exists "streaks_update_own" on public.streaks;
create policy "streaks_update_own"
  on public.streaks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Upserts on court_checkins fire UPDATE OF checked_in_at; first row is INSERT — handle both.
create or replace function public.update_streak()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := new.user_id;
  today date := ((now() at time zone 'utc'))::date;
  prev_date date;
  cur int;
  lng int;
begin
  if uid is null then
    return new;
  end if;

  insert into public.streaks (
    user_id,
    current_streak,
    longest_streak,
    last_checkin_date,
    updated_at,
    milestone_celebrated
  )
  values (uid, 1, 1, today, now(), '')
  on conflict (user_id) do nothing;

  select s.last_checkin_date, s.current_streak, s.longest_streak
    into prev_date, cur, lng
  from public.streaks s
  where s.user_id = uid
  for update;

  if prev_date is not distinct from today then
    return new;
  end if;

  if prev_date is not null and prev_date = today - 1 then
    cur := cur + 1;
  else
    cur := 1;
  end if;

  lng := greatest(coalesce(lng, 0), cur);

  update public.streaks
  set
    current_streak = cur,
    longest_streak = lng,
    last_checkin_date = today,
    updated_at = now()
  where user_id = uid;

  return new;
end;
$$;

drop trigger if exists court_checkins_update_streak on public.court_checkins;
create trigger court_checkins_update_streak
after insert or update of checked_in_at on public.court_checkins
for each row execute function public.update_streak();
