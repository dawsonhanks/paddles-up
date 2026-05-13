-- Account deletion: wipe public data for auth.uid(), then delete auth user via Edge Function (service role).
-- Invoke only from trusted Edge Function with the user's JWT, or from client as rpc (then still need Edge for auth delete).

create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Messages (any message in conversations involving this user, or sent by them)
  delete from public.messages m
  where m.sender_id = uid
     or exists (
       select 1
       from public.conversations c
       where c.id = m.conversation_id
         and (c.player1_id = uid or c.player2_id = uid)
     );

  -- 2. Conversations
  delete from public.conversations
  where player1_id = uid or player2_id = uid;

  -- 3. Content reports (filed by user, or profile-target reports about this user)
  delete from public.content_reports
  where reporter_id = uid
     or (content_type = 'profile' and content_id = uid);

  -- 4. Block list (either side)
  delete from public.blocked_users
  where blocker_id = uid or blocked_id = uid;

  -- 5–6. Notifications (tables may be created outside repo migrations)
  if to_regclass('public.notification_subscriptions') is not null then
    execute format('delete from public.notification_subscriptions where user_id = %L', uid);
  end if;
  if to_regclass('public.notification_tokens') is not null then
    execute format('delete from public.notification_tokens where user_id = %L', uid);
  end if;

  -- 7. Court check-ins
  if to_regclass('public.court_checkins') is not null then
    execute format('delete from public.court_checkins where user_id = %L', uid);
  end if;

  -- 8. Zone reports
  if to_regclass('public.zone_reports') is not null then
    execute format('delete from public.zone_reports where user_id = %L', uid);
  end if;

  -- 9. Availability reports (only if a user_id column exists)
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'availability_reports'
      and column_name = 'user_id'
  ) then
    execute format('delete from public.availability_reports where user_id = %L', uid);
  end if;

  -- 10. Quick checkout ratings (optional table)
  if to_regclass('public.court_ratings') is not null then
    execute format('delete from public.court_ratings where user_id = %L', uid);
  end if;

  -- 11. Written reviews
  delete from public.court_reviews where user_id = uid;

  -- 12. Court photos
  delete from public.court_photos where user_id = uid;

  -- 13. Scheduled sessions / reminders
  delete from public.scheduled_sessions where user_id = uid;

  -- 14–15. Game posts & accepts (join rows on others’ posts, then posts authored by user)
  delete from public.accepts where user_id = uid;
  if to_regclass('public.game_posts') is not null then
    execute format('delete from public.game_posts where user_id = %L', uid);
  end if;

  -- 16. Challenges (cascade-linked matches)
  if to_regclass('public.challenges') is not null then
    execute format(
      'delete from public.challenges where challenger_id = %L or challenged_id = %L',
      uid,
      uid
    );
  end if;

  -- Matches (rows owned by this user; any remaining tied to deleted challenges are already gone)
  delete from public.matches where user_id = uid;

  -- 17. Friendships (directional rows either way)
  if to_regclass('public.friendships') is not null then
    execute format(
      'delete from public.friendships where user_id = %L or friend_id = %L',
      uid,
      uid
    );
  end if;

  -- 18. Favorites
  delete from public.favorites where user_id = uid;

  -- Streaks (if present)
  if to_regclass('public.streaks') is not null then
    execute format('delete from public.streaks where user_id = %L', uid);
  end if;

  -- Court submissions (optional attribution) before players
  if to_regclass('public.court_submissions') is not null then
    execute format('delete from public.court_submissions where user_id = %L', uid);
  end if;

  -- 19. Player profile row
  delete from public.players where user_id = uid;
end;
$$;

revoke all on function public.delete_user_account() from public;
grant execute on function public.delete_user_account() to authenticated;
grant execute on function public.delete_user_account() to service_role;

comment on function public.delete_user_account() is
  'Deletes all app data for auth.uid(). Call from client with user JWT, then delete auth user via Edge Function admin API.';
