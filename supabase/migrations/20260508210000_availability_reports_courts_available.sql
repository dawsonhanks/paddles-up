-- Venue-wide availability count (new rows). Legacy per-court rows still use court_number + status.

alter table public.availability_reports
  add column if not exists courts_available int4;

alter table public.availability_reports
  alter column court_number drop not null;

alter table public.availability_reports
  alter column status drop not null;

alter table public.availability_reports
  add constraint availability_reports_courts_available_nonneg_chk
  check (courts_available is null or courts_available >= 0);
