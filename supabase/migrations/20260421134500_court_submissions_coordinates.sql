alter table public.court_submissions
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocode_source text,
  add column if not exists geocode_confidence text;
