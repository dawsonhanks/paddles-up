-- Reads use .gt('expires_at', now); without this column inserts/selects break or return no rows.

alter table public.availability_reports
  add column if not exists expires_at timestamptz;

update public.availability_reports
set expires_at = created_at + interval '30 minutes'
where expires_at is null;

alter table public.availability_reports
  alter column expires_at set default (now() + interval '30 minutes');

alter table public.availability_reports
  alter column expires_at set not null;

create index if not exists availability_reports_court_expires_created_idx
  on public.availability_reports (court_id, expires_at desc, created_at desc);
