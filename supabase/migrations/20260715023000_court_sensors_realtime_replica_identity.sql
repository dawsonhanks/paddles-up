-- Filtered Realtime UPDATEs (e.g. court_id=eq.<uuid>) require FULL replica identity
-- so non-PK columns are present in the WAL payload for filtering.
-- See: https://supabase.com/docs/guides/realtime/postgres-changes
alter table public.court_sensors replica identity full;

-- Map + detail screens already subscribe to these; ensure they are published.
do $$
begin
  alter publication supabase_realtime add table public.availability_reports;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.court_checkins;
exception
  when duplicate_object then null;
end $$;

alter table public.availability_reports replica identity full;
alter table public.court_checkins replica identity full;
