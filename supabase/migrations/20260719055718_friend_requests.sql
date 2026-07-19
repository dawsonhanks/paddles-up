-- Pending friend requests (mutual friendships are created on accept in app/RPC layer later).
-- Friendships table and its RLS are intentionally left unchanged in this migration.

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_no_self check (from_user <> to_user)
);

-- One pending request per directed pair (A→B). Re-request after accept/decline is allowed
-- if the prior row is no longer status = 'pending' (or was deleted).
create unique index if not exists friend_requests_pending_pair_uidx
  on public.friend_requests (from_user, to_user)
  where status = 'pending';

create index if not exists friend_requests_to_user_pending_idx
  on public.friend_requests (to_user)
  where status = 'pending';

create index if not exists friend_requests_from_user_pending_idx
  on public.friend_requests (from_user)
  where status = 'pending';

alter table public.friend_requests enable row level security;

drop policy if exists "friend_requests_select_participants" on public.friend_requests;
create policy "friend_requests_select_participants"
  on public.friend_requests
  for select
  to authenticated
  using (auth.uid() = from_user or auth.uid() = to_user);

drop policy if exists "friend_requests_insert_own" on public.friend_requests;
create policy "friend_requests_insert_own"
  on public.friend_requests
  for insert
  to authenticated
  with check (auth.uid() = from_user);

-- Recipient-only updates (accept/decline via status + responded_at).
-- Sender cannot update; they cancel via DELETE.
drop policy if exists "friend_requests_update_recipient" on public.friend_requests;
create policy "friend_requests_update_recipient"
  on public.friend_requests
  for update
  to authenticated
  using (auth.uid() = to_user)
  with check (auth.uid() = to_user);

-- Sender cancels; recipient may decline via delete (if app chooses delete over status update).
drop policy if exists "friend_requests_delete_participants" on public.friend_requests;
create policy "friend_requests_delete_participants"
  on public.friend_requests
  for delete
  to authenticated
  using (auth.uid() = from_user or auth.uid() = to_user);
