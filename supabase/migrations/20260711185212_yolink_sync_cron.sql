-- Schedule YoLink motion sensor polling via pg_cron + pg_net.
-- pg_cron minimum granularity is 1 minute; sub-minute polling is not supported natively.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Replace YOUR_ANON_KEY_HERE with your project's anon key from
-- Supabase Dashboard → Settings → API before running this migration.
alter database postgres set app.settings.anon_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqcGtyY3Rxc2Vrd2h6aG1kcG12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MzU1MDUsImV4cCI6MjA5MTExMTUwNX0.ee30V4pjNw-I_CQszQl6xCoQ0j3Fv9QEL5IE3vyqGIY';

-- Poll the yolink-sync Edge Function every minute.
select cron.schedule(
  'yolink-sync-poll',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://pjpkrctqsekwhzhmdpmv.supabase.co/functions/v1/yolink-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    )
  );
  $$
);

-- Helper: check recent cron job runs
-- select * from cron.job_run_details order by start_time desc limit 5;

-- Helper: unschedule later if needed
-- select cron.unschedule('yolink-sync-poll');
