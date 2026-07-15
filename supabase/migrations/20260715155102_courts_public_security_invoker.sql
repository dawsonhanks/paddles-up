-- Recreate courts_public as security_invoker so callers hit courts RLS as themselves
-- (clears Security Definer View advisory). Keep the same public filter.

create or replace view public.courts_public
with (security_invoker = true)
as
select
  id,
  name,
  address,
  latitude,
  longitude,
  num_courts,
  surface_type,
  indoor_outdoor,
  fee,
  hours,
  rating,
  confidence_score,
  last_verified,
  source
from public.courts
where public_api = true
  and confidence_score >= 0.4::double precision;

revoke all on table public.courts_public from public, anon, authenticated;
grant select on table public.courts_public to anon, authenticated;
