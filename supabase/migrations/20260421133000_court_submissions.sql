create table if not exists public.court_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  display_name text,
  court_name text not null,
  address text not null,
  city text not null,
  state text,
  num_courts int4 not null,
  surface_type text not null,
  indoor_outdoor text not null,
  fee text not null,
  hours text not null,
  notes text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.court_submissions enable row level security;

create policy "court submissions insert for anyone"
  on public.court_submissions
  for insert
  to anon, authenticated
  with check (true);

create policy "court submissions select own"
  on public.court_submissions
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Needed for the in-app /admin/submissions moderation screen.
create policy "court submissions select pending for moderation"
  on public.court_submissions
  for select
  to authenticated
  using (status = 'pending');

create policy "court submissions update for moderation"
  on public.court_submissions
  for update
  to authenticated
  using (status = 'pending')
  with check (status in ('approved', 'rejected'));
