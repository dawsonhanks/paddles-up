-- Game post accepts: who joined which post; atomic accept/unaccept via RPC.

create table if not exists public.accepts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.game_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index if not exists accepts_post_id_idx on public.accepts (post_id);
create index if not exists accepts_user_id_idx on public.accepts (user_id);

alter table public.accepts enable row level security;

create policy "accepts_select_all"
  on public.accepts for select
  using (true);

create policy "accepts_insert_own"
  on public.accepts for insert
  with check (auth.uid() = user_id);

create policy "accepts_delete_own"
  on public.accepts for delete
  using (auth.uid() = user_id);

-- RPCs use SECURITY DEFINER so they can update game_posts.players_needed without broad RLS on game_posts.

create or replace function public.accept_game_post(p_post_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  poster uuid;
  need int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select gp.user_id, gp.players_needed into poster, need
  from public.game_posts gp
  where gp.id = p_post_id
  for update;

  if not found then
    raise exception 'post not found';
  end if;

  if poster = auth.uid() then
    raise exception 'cannot accept your own post';
  end if;

  if need <= 0 then
    raise exception 'game is full';
  end if;

  insert into public.accepts (post_id, user_id, display_name)
  values (p_post_id, auth.uid(), p_display_name);

  update public.game_posts
  set players_needed = players_needed - 1
  where id = p_post_id;
end;
$$;

create or replace function public.unaccept_game_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.accepts
  where post_id = p_post_id and user_id = auth.uid();

  get diagnostics deleted_count = row_count;

  if deleted_count > 0 then
    update public.game_posts
    set players_needed = players_needed + 1
    where id = p_post_id;
  end if;
end;
$$;

revoke all on public.accepts from anon, authenticated;
grant select on public.accepts to anon, authenticated;

grant execute on function public.accept_game_post(uuid, text) to anon, authenticated;
grant execute on function public.unaccept_game_post(uuid) to anon, authenticated;
