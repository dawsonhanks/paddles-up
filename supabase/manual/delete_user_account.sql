-- Paste into Supabase SQL Editor (same as migration 20260514120000_delete_user_account.sql).
--
-- After this runs:
-- 1. Deploy Edge Function: `supabase functions deploy delete-account --no-verify-jwt` (or verify JWT in dashboard).
-- 2. Set project secrets for the function: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
--    (Dashboard → Edge Functions → delete-account → Secrets; CLI: supabase secrets set ...)

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

  delete from public.messages m
  where m.sender_id = uid
     or exists (
       select 1
       from public.conversations c
       where c.id = m.conversation_id
         and (c.player1_id = uid or c.player2_id = uid)
     );

  delete from public.conversations
  where player1_id = uid or player2_id = uid;

  delete from public.content_reports
  where reporter_id = uid
     or (content_type = 'profile' and content_id = uid);

  delete from public.blocked_users
  where blocker_id = uid or blocked_id = uid;

  if to_regclass('public.notification_subscriptions') is not null then
    execute format('delete from public.notification_subscriptions where user_id = %L', uid);
  end if;
  if to_regclass('public.notification_tokens') is not null then
    execute format('delete from public.notification_tokens where user_id = %L', uid);
  end if;

  if to_regclass('public.court_checkins') is not null then
    execute format('delete from public.court_checkins where user_id = %L', uid);
  end if;

  if to_regclass('public.zone_reports') is not null then
    execute format('delete from public.zone_reports where user_id = %L', uid);
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'availability_reports'
      and column_name = 'user_id'
  ) then
    execute format('delete from public.availability_reports where user_id = %L', uid);
  end if;

  if to_regclass('public.court_ratings') is not null then
    execute format('delete from public.court_ratings where user_id = %L', uid);
  end if;

  delete from public.court_reviews where user_id = uid;

  delete from public.court_photos where user_id = uid;

  delete from public.scheduled_sessions where user_id = uid;

  delete from public.accepts where user_id = uid;
  if to_regclass('public.game_posts') is not null then
    execute format('delete from public.game_posts where user_id = %L', uid);
  end if;

  if to_regclass('public.challenges') is not null then
    execute format(
      'delete from public.challenges where challenger_id = %L or challenged_id = %L',
      uid,
      uid
    );
  end if;

  delete from public.matches where user_id = uid;

  if to_regclass('public.friendships') is not null then
    execute format(
      'delete from public.friendships where user_id = %L or friend_id = %L',
      uid,
      uid
    );
  end if;

  delete from public.favorites where user_id = uid;

  if to_regclass('public.streaks') is not null then
    execute format('delete from public.streaks where user_id = %L', uid);
  end if;

  if to_regclass('public.court_submissions') is not null then
    execute format('delete from public.court_submissions where user_id = %L', uid);
  end if;

  delete from public.players where user_id = uid;
end;
$$;

revoke all on function public.delete_user_account() from public;
grant execute on function public.delete_user_account() to authenticated;
grant execute on function public.delete_user_account() to service_role;
