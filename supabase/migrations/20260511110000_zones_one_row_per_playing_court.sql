-- Align zones with courts.num_courts: each venue gets "Court 1" .. "Court N" for optional Open/Busy.
-- Replaces directional seeds and the single "Courts" placeholder. Deletes all zone rows (cascades zone_reports).

drop trigger if exists courts_after_insert_default_zone on public.courts;
drop function if exists public.ensure_default_court_zone();

create or replace function public.sync_zones_for_court(p_court_id uuid, p_num_courts integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := least(greatest(coalesce(p_num_courts, 1), 1), 200);
begin
  delete from public.zones where court_id = p_court_id;
  insert into public.zones (court_id, zone_name, display_order)
  select p_court_id, format('Court %s', gs.n)::text, gs.n - 1
  from generate_series(1, n) as gs(n);
end;
$$;

delete from public.zones;

insert into public.zones (court_id, zone_name, display_order)
select c.id, format('Court %s', gs.n)::text, gs.n - 1
from public.courts c
cross join lateral generate_series(
  1,
  least(greatest(coalesce(c.num_courts, 1), 1), 200)
) as gs(n);

create or replace function public.courts_sync_zones_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_zones_for_court(new.id, new.num_courts);
  return new;
end;
$$;

create or replace function public.courts_sync_zones_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.num_courts is distinct from new.num_courts then
    perform public.sync_zones_for_court(new.id, new.num_courts);
  end if;
  return new;
end;
$$;

drop trigger if exists courts_after_insert_sync_zones on public.courts;
create trigger courts_after_insert_sync_zones
  after insert on public.courts
  for each row
  execute function public.courts_sync_zones_after_insert();

drop trigger if exists courts_after_update_sync_zones on public.courts;
create trigger courts_after_update_sync_zones
  after update of num_courts on public.courts
  for each row
  execute function public.courts_sync_zones_after_update();
