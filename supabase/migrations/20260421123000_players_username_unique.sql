-- Enforce unique player nickname/username (case-insensitive), ignoring null/blank values.
create unique index if not exists players_username_unique_ci_idx
  on public.players (lower(username))
  where username is not null and btrim(username) <> '';
