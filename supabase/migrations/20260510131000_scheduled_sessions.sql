-- Personal session scheduling (Play tab reminders).

create table if not exists public.scheduled_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete restrict,
  court_name text not null,
  session_date timestamptz not null,
  notes text,
  reminder_sent boolean not null default false,
  notification_id text,
  created_at timestamptz not null default now()
);

create index if not exists scheduled_sessions_user_session_date_idx
  on public.scheduled_sessions (user_id, session_date);

alter table public.scheduled_sessions enable row level security;

create policy "scheduled_sessions_select_own"
  on public.scheduled_sessions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "scheduled_sessions_insert_own"
  on public.scheduled_sessions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "scheduled_sessions_update_own"
  on public.scheduled_sessions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "scheduled_sessions_delete_own"
  on public.scheduled_sessions
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on table public.scheduled_sessions to authenticated;

comment on column public.scheduled_sessions.notification_id is 'Expo local notification identifier returned from scheduleNotificationAsync; used to cancel reminders.';

-- Optional venue + meet time on game posts (prefill Add to my sessions).

alter table public.game_posts
  add column if not exists court_id uuid references public.courts (id) on delete set null;

alter table public.game_posts
  add column if not exists session_starts_at timestamptz;

create index if not exists game_posts_court_id_idx on public.game_posts (court_id) where court_id is not null;
