-- Auto-confirm email on signup (equivalent to disabling "Confirm email" in Auth settings).
-- GoTrue still requires email_confirmed_at before issuing a session when confirm is enabled.

create or replace function public.autoconfirm_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = auth, public
as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  if new.confirmed_at is null then
    new.confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists autoconfirm_auth_user_email on auth.users;

create trigger autoconfirm_auth_user_email
  before insert on auth.users
  for each row
  execute function public.autoconfirm_auth_user_email();
