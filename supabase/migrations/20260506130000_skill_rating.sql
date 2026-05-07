alter table public.players
  add column if not exists skill_rating float4;

do $$
declare
  rec record;
begin
  for rec in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'players'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%skill_rating%'
  loop
    execute format('alter table public.players drop constraint if exists %I', rec.conname);
  end loop;
end $$;

alter table public.players
  add constraint players_skill_rating_check
  check (
    skill_rating is null
    or (
      skill_rating >= 1.0
      and skill_rating <= 5.0
      and mod((skill_rating * 10)::int, 5) = 0
    )
  );
