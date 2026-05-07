-- Group games: game type, richer accepts, pickup skill on players.

alter table public.game_posts
  add column if not exists game_type text not null default 'open'
  constraint game_posts_game_type_check
  check (game_type = any (array['singles'::text, 'doubles'::text, 'open'::text]));

alter table public.accepts
  add column if not exists skill_level text;

alter table public.players
  add column if not exists pickup_skill_level text
  constraint players_pickup_skill_level_check
  check (
    pickup_skill_level is null
    or pickup_skill_level = any (array['Beginner'::text, 'Intermediate'::text, 'Advanced'::text])
  );

-- Replace accept RPC: optional joiner skill, same decrement logic.
drop function if exists public.accept_game_post(uuid, text);

create or replace function public.accept_game_post(
  p_post_id uuid,
  p_display_name text,
  p_skill_level text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  poster uuid;
  need int;
  skill_trim text := nullif(trim(coalesce(p_skill_level, '')), '');
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

  insert into public.accepts (post_id, user_id, display_name, skill_level)
  values (p_post_id, auth.uid(), p_display_name, skill_trim);

  update public.game_posts
  set players_needed = players_needed - 1
  where id = p_post_id;
end;
$$;

grant execute on function public.accept_game_post(uuid, text, text) to anon, authenticated;
