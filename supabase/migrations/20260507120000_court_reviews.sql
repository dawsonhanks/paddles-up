-- Written court reviews + aggregate rating prefers review over quick checkout per user.

create table if not exists public.court_reviews (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  rating int4 not null,
  review_text text not null default '',
  created_at timestamptz not null default now(),
  constraint court_reviews_rating_check check (rating >= 1 and rating <= 5)
);

create unique index if not exists court_reviews_user_court_uidx on public.court_reviews (user_id, court_id);
create index if not exists court_reviews_court_created_idx on public.court_reviews (court_id, created_at desc);

alter table public.court_reviews enable row level security;

grant select on table public.court_reviews to anon, authenticated;
grant insert, update on table public.court_reviews to authenticated;

create policy "court_reviews_select_public"
  on public.court_reviews for select to anon, authenticated using (true);

create policy "court_reviews_insert_own"
  on public.court_reviews for insert to authenticated
  with check (auth.uid() = user_id);

create policy "court_reviews_update_own"
  on public.court_reviews for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One row per user: written review (pri 2) wins over checkout court_ratings (pri 1) for the aggregate.
create or replace function public.refresh_court_rating_from_feedback(p_court_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v numeric;
begin
  select round(avg(picked.rating)::numeric, 1)
    into v
  from (
    select distinct on (u.user_id) u.rating
    from (
      select cr.user_id, cr.rating, 2 as pri from public.court_reviews cr where cr.court_id = p_court_id
      union all
      select r.user_id, r.rating, 1 as pri from public.court_ratings r where r.court_id = p_court_id
    ) u
    order by u.user_id, u.pri desc
  ) picked;

  update public.courts c
  set rating = v
  where c.id = p_court_id;
end;
$$;

create or replace function public.update_court_rating()
returns trigger
language plpgsql
as $$
begin
  perform public.refresh_court_rating_from_feedback(new.court_id);
  return new;
end;
$$;

create or replace function public.update_court_avg_rating()
returns trigger
language plpgsql
as $$
begin
  perform public.refresh_court_rating_from_feedback(new.court_id);
  return new;
end;
$$;

create or replace function public.trg_court_reviews_touch_court_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  cid := coalesce(new.court_id, old.court_id);
  if cid is not null then
    perform public.refresh_court_rating_from_feedback(cid);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists court_reviews_rating_trigger on public.court_reviews;
create trigger court_reviews_rating_trigger
after insert or update or delete on public.court_reviews
for each row execute function public.trg_court_reviews_touch_court_rating();

do $$
declare
  r record;
begin
  for r in select id from public.courts loop
    perform public.refresh_court_rating_from_feedback(r.id);
  end loop;
end $$;
