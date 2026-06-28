# Paddles Up — Pre-Submission Audit Checklist

Updated June 27, 2026 with Cursor's full code audit (supersedes the earlier quick-scan pass). Full line-level detail is in the chat history with Cursor's output — this file tracks status.

## Blockers (fix before submitting)

- [x] Upload profile avatars to Supabase Storage instead of saving the local device path — `app/(tabs)/settings.tsx:212,265`
- [x] Lock down `content_reports` SELECT to admins only (any authenticated user can currently read all abuse reports) — `supabase/migrations/20260627120000_content_reports_select_admin_only.sql`
- [x] Restrict the Google Maps API key in Google Cloud Console to bundle ID `com.paddlesup.app` + Maps SDK, and document it — `app.json:24`, `app.config.js`

## Should-fix

- [ ] Sanitize delete-account Edge Function error messages (currently returns raw Postgres/auth errors to the client) — `supabase/functions/delete-account/index.ts:50-71`
- [ ] Handle partial delete-account failure — DB rows get wiped even if `auth.admin.deleteUser` fails afterward — `supabase/functions/delete-account/index.ts:56-72`
- [ ] Wire up or delete the unreachable `app/admin/reports.tsx` screen — `app/_layout.tsx:186`
- [ ] Add error handling for silent query failures: match history, game posts, public profile, friends search — `app/(tabs)/record.tsx:200`, `app/(tabs)/play.tsx:390`, `app/profile/[username].tsx:41`, `app/(tabs)/friends.tsx:172`
- [ ] Add explicit error handling around the public profile match-stats query, which currently relies entirely on RLS holding — `app/profile/[username].tsx:53-56`
- [ ] Delete or sync the stale `privacy.html` (wrong contact email vs. the live policy page)
- [ ] Run one live end-to-end delete-account test on production before submitting

## Nice-to-have

- [ ] Resize images to a max dimension (~1200px) before court photo upload — `app/court/[id].tsx:573`
- [ ] Fix the `as any` icon type cast — `app/(tabs)/settings.tsx:589`
- [ ] Convert the challenges list to `FlatList` if it grows past a handful of items — `app/(tabs)/record.tsx:717-734`
- [ ] Centralize the repeated `ensureFavoritesUser()` + fetch pattern (~15 screens) into shared hooks
- [ ] Sanitize the raw Supabase error before storing it (already sanitized at display time) — `app/(tabs)/index.tsx:454`
- [ ] Review permissive RLS INSERT policies flagged by the Supabase advisor (`accepts`, `favorites`, etc.) as defense-in-depth

## Confirmed clean — no action needed

- [x] Client uses the anon key only; service role key confined to the Edge Function — `supabase.ts:6-7`
- [x] No hardcoded test/admin accounts; admin UI gated by `players.admin`
- [x] Account deletion is real and server-side — 19+ tables wiped, then the auth user is deleted
- [x] Privacy policy linked in-app (Auth + Settings), URLs match config
- [x] Permission strings match actual usage; no ATT needed (no tracking SDK present)
- [x] Location requested contextually via a purpose modal, not as a blanket upfront prompt
- [x] Realtime channels and location watchers are cleaned up on unmount
- [x] Offline and location-denied states are handled gracefully
- [x] Missing Supabase config is handled without a crash
- [x] Error boundary wraps the app
- [x] No `console.log`/`TODO`/`FIXME` left in app code
- [x] Court list and map use proper list virtualization

---
Source: Cursor audit, June 27, 2026.
