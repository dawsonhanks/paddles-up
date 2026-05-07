-- Courts with num_courts < 4 never received rows from the original zones seed.
-- Ensure every venue has at least one zone so optional Open/Busy reporting appears in the app.

insert into public.zones (court_id, zone_name, display_order)
select c.id, 'Courts'::text, 0
from public.courts c
where not exists (select 1 from public.zones z where z.court_id = c.id);

create or replace function public.ensure_default_court_zone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.zones (court_id, zone_name, display_order)
  select new.id, 'Courts'::text, 0
  where not exists (select 1 from public.zones z where z.court_id = new.id);
  return new;
end;
$$;

drop trigger if exists courts_after_insert_default_zone on public.courts;
create trigger courts_after_insert_default_zone
  after insert on public.courts
  for each row
  execute function public.ensure_default_court_zone();
