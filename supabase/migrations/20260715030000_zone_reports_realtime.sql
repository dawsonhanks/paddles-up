-- Court detail derives "X of Y courts open" from zone Open/Busy (zone_reports + sensors).
-- Publish zone_reports so remote toggles refresh the headline live.
do $$
begin
  alter publication supabase_realtime add table public.zone_reports;
exception
  when duplicate_object then null;
end $$;

alter table public.zone_reports replica identity full;
