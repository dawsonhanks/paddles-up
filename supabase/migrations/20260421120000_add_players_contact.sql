-- Add optional contact (email or phone) for players. Run in Supabase SQL Editor if you don't apply migrations.
alter table public.players
  add column if not exists contact text;

comment on column public.players.contact is 'User-provided email or phone from profile.';
