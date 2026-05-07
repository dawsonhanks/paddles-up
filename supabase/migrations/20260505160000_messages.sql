create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  player1_id uuid not null references auth.users(id) on delete cascade,
  player2_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint conversations_player_order_check check (player1_id <> player2_id)
);

create unique index if not exists conversations_pair_unique_idx
  on public.conversations (least(player1_id, player2_id), greatest(player1_id, player2_id));

create index if not exists conversations_player1_idx on public.conversations (player1_id);
create index if not exists conversations_player2_idx on public.conversations (player2_id);
create index if not exists conversations_last_message_idx on public.conversations (last_message_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now(),
  read boolean not null default false
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_unread_idx
  on public.messages (conversation_id, read, sender_id);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "conversations_select_participants" on public.conversations;
create policy "conversations_select_participants"
  on public.conversations for select
  to authenticated
  using (auth.uid() in (player1_id, player2_id));

drop policy if exists "conversations_insert_participants" on public.conversations;
create policy "conversations_insert_participants"
  on public.conversations for insert
  to authenticated
  with check (auth.uid() in (player1_id, player2_id));

drop policy if exists "conversations_update_participants" on public.conversations;
create policy "conversations_update_participants"
  on public.conversations for update
  to authenticated
  using (auth.uid() in (player1_id, player2_id))
  with check (auth.uid() in (player1_id, player2_id));

drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.player1_id, c.player2_id)
    )
  );

drop policy if exists "messages_insert_participants" on public.messages;
create policy "messages_insert_participants"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.player1_id, c.player2_id)
    )
  );

drop policy if exists "messages_update_participants" on public.messages;
create policy "messages_update_participants"
  on public.messages for update
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.player1_id, c.player2_id)
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.player1_id, c.player2_id)
    )
  );

create or replace function public.touch_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_last_message();
