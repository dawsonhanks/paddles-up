-- App queries order by created_at; add if the table was created manually without this column.
alter table public.availability_reports
  add column if not exists created_at timestamptz not null default now();

create index if not exists availability_reports_court_created_idx
  on public.availability_reports (court_id, created_at desc);
