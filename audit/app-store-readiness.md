# Paddles Up — App Store Submission Readiness Audit

**Read-only audit — no code changes were made.**
Date: 2026-07-21 · App: Paddles Up (`com.paddlesup.app`) · Expo SDK 54 / React Native 0.81 (managed workflow, no committed `ios/` folder).

## Summary

| # | Item | Status |
|---|------|--------|
| 1 | Account deletion (5.1.1v) | ✅ PASS |
| 2 | UGC safety (1.2) | ⚠️ NEEDS ATTENTION (report ✅ / block ✅ / **EULA ❌** / act-on-reports ⚠️) |
| 3 | Sign-in parity (4.8) | ✅ PASS (not triggered) |
| 4 | Privacy manifest & permissions | ⚠️ NEEDS ATTENTION |
| 5 | App Tracking Transparency | ✅ PASS (not required) |
| 6 | Minimum functionality / completeness (2.1 / 4.2) | ⚠️ NEEDS ATTENTION (reviewer account) |
| 7 | Location usage justification | ✅ PASS |
| 8 | Export compliance | ✅ PASS |
| 9 | Contact & support info | ⚠️ NEEDS ATTENTION |
| 10 | Crash / error handling | ✅ PASS |

**Top priorities before submission:** (1) Publish and link a Terms of Use / EULA with a zero-tolerance clause (2.b below), (2) provide reviewer demo credentials in App Store Connect (item 6), (3) declare a privacy manifest / data-collection types (item 4.a), (4) confirm the abuse-report review path (item 2.d).

---

## 1. Account Deletion (Guideline 5.1.1v) — ✅ PASS

A signed-in user can permanently delete their account and all associated data from within the app.

**Evidence**
- Delete Account button in Settings: `app/(tabs)/settings.tsx:777-784` → `confirmDeleteAccount()` shows a destructive confirmation alert `app/(tabs)/settings.tsx:562-571`.
- Deletion runs server-side: `runDeleteAccount()` `app/(tabs)/settings.tsx:573-589` → `invokeDeleteAccountEdge()` `lib/deleteAccount.ts:15-57` (calls the `delete-account` Edge Function with the user's JWT).
- Edge Function calls the `delete_user_account` RPC then hard-deletes the auth user: `supabase/functions/delete-account/index.ts:56-73`.
- RPC wipes ~19 data tables (messages, conversations, reports, blocks, notifications, check-ins, reviews, photos, sessions, game posts, challenges, matches, friendships, favorites, streaks, submissions, player profile): `supabase/migrations/20260514120000_delete_user_account.sql:17-124`.
- After success the client signs out and returns to `/auth`: `app/(tabs)/settings.tsx:581-583`.

This is a true permanent deletion (not just log-out), with an explicit "cannot be undone" confirmation.

> Note (not a blocker): `APP_STORE_AUDIT_CHECKLIST.md:14` flags that DB rows are wiped before `auth.admin.deleteUser`, so a failure after the RPC could orphan an auth user with no data. Worth one live end-to-end test on production before submitting.

---

## 2. UGC Safety (Guideline 1.2) — ⚠️ NEEDS ATTENTION

The app has friend requests, challenges, messages, reviews, game posts, and court photos — so all four UGC safeguards apply.

### 2.a Report another user / objectionable content — ✅ PASS
- Report reason sheet component: `components/report-reason-modal.tsx` (reasons: Inappropriate content, Spam, Harassment, False information, Other — `lib/contentReports.ts:6-12`).
- Long-press → "Report" action sheet: `lib/showReportMenu.ts:6-25`.
- Wired into profiles, messages, reviews, posts: `app/friends/[id].tsx:218`, `app/messages/[id].tsx`, `app/court/reviews/[id].tsx`, `app/court/[id].tsx`, `app/(tabs)/play.tsx`.
- Reports persist to `content_reports` via `submitContentReport()` `lib/contentReports.ts:16-34`.

### 2.b Block another user — ✅ PASS
- Block from a player profile: `app/friends/[id].tsx:116-134` (Block button `:301-305`) → `blockUser()` `lib/blockedUsers.ts:68-86`.
- Manage/unblock screen: `app/blocked-players.tsx` (reachable from Settings `app/(tabs)/settings.tsx:715-722`).
- Blocked users are hidden from lists/searches (fetched via `fetchBlockedUserIds()` `lib/blockedUsers.ts:4-12`).

### 2.c Terms of Use / EULA with zero-tolerance policy, linked in-app — ❌ MISSING
- Only a **Privacy Policy** is linked (`app/auth.tsx:35,278-287`, `app/(tabs)/settings.tsx:65-68`). A repo-wide search for "Terms of Use / Terms of Service / EULA / zero-tolerance / objectionable" returned **no matches**.
- Apple 1.2 requires apps with UGC to have a EULA/terms the user agrees to, containing a **zero-tolerance policy for objectionable content and abusive users**.
- **Suggested fix:** Publish a Terms of Use / EULA page (can live beside the existing GitHub Pages privacy site) containing an explicit zero-tolerance clause, then link it on the sign-up screen and in Settings, and add an "I agree" affordance at account creation.

### 2.d Mechanism to act on reports — ⚠️ NEEDS ATTENTION
- Reports are stored and SELECT is correctly locked to admins only: `supabase/migrations/20260627120000_content_reports_select_admin_only.sql`.
- An in-app admin review screen exists (`app/admin/reports.tsx`) **but is not registered in the router** (`app/_layout.tsx:219-235` has no `admin/reports` screen) and nothing navigates to `/admin/reports` — it is effectively unreachable in-app (also flagged in `APP_STORE_AUDIT_CHECKLIST.md:15`). Admins can still triage via the Supabase dashboard, and blocking gives users immediate self-service relief.
- **Suggested fix:** Either wire the existing `admin/reports.tsx` screen into navigation (gated by `players.admin`) or document the manual review path (Supabase dashboard + a monitored abuse email), and commit to acting on reports within 24 hours as Apple expects.

---

## 3. Sign-In Parity (Guideline 4.8) — ✅ PASS (not triggered)

- The only sign-in method is **email + password** via Supabase Auth: `lib/auth.ts:103-199`, `app/auth.tsx` (Sign Up / Log In tabs, forgot-password). No Google, Apple, Facebook, phone, or other third-party/social login exists anywhere in the codebase.
- Because there is **no third-party social login**, "Sign in with Apple" is **not required**. If a social provider is added later, Sign in with Apple (or a qualifying alternative) becomes mandatory.

---

## 4. Privacy Manifest & Permissions — ⚠️ NEEDS ATTENTION

### 4.a PrivacyInfo.xcprivacy — ⚠️ NEEDS ATTENTION
- No `.xcprivacy` file is committed (expected — this is a managed Expo project with no `ios/` directory; the native project is generated by EAS at build time). There is also **no `ios.privacyManifests` key** in `app.json` / `app.config.js`.
- Expo SDK 54 auto-generates a baseline `PrivacyInfo.xcprivacy` (required-reason API entries for its own modules such as file system / user defaults / system boot time) during prebuild, so builds will not be rejected purely for a missing file. However, **data-collection declarations (`NSPrivacyCollectedDataTypes`) are not explicitly declared**.
- **Suggested fix:** Add an `ios.privacyManifests` block to the app config declaring collected data types (email, user content, coarse+precise location, identifiers/push token) and any required-reason API usage not already covered by Expo, and keep it consistent with the App Store Connect privacy "nutrition label."

### 4.b Usage description strings — ✅ PASS
All present with specific, real (non-placeholder) copy, and kept in sync in `lib/location-permissions.ts`:
- `NSLocationWhenInUseUsageDescription` — `app.json:18` (nearby courts, check-in verification, auto check-in; "only while the app is open").
- `NSPhotoLibraryUsageDescription` — `app.json:19` (profile picture / court photos).
- `NSCameraUsageDescription` — `app.json:20` (court photos at the venue).
- `expo-location` / `expo-image-picker` plugin strings match: `app.json:47-66`.
- Notification permission is requested **in context** with a purpose modal, not blanket at launch: `components/notification-purpose-modal.tsx`, `app/court/[id].tsx:199,828-896`; root layout never triggers the system dialog (`app/_layout.tsx:35-62`).
- `NSLocationAlwaysUsageDescription` is intentionally absent (no background location — see item 7). ✅ correct.

### 4.c Third-party SDKs that collect data — ⚠️ NEEDS ATTENTION (declaration only)
- **Supabase (`@supabase/supabase-js`)** — first-party backend (auth, Postgres, storage, realtime). Transmits email, user-generated content, and location-derived data. Must be reflected in App Store Connect privacy labels (data linked to the user). No separate vendor privacy manifest required (network SDK).
- **Google Maps iOS SDK (via `react-native-maps` + `ios.config.googleMapsApiKey`, `app.json:23-25`)** — Google's Maps SDK collects data and ships **its own** privacy manifest inside the SDK; ensure your ASC labels account for map/location usage.
- **`expo-notifications`** — collects/stores a push token (`app/_layout.tsx:99-102`); treat the token as an identifier in privacy labels.
- **No analytics, crash-reporting, or advertising SDKs** are present (confirmed by dependency scan and by the live privacy policy: `paddles-up-privacy/index.html:61,69`).
- **Suggested fix:** Make sure the App Store Connect privacy questionnaire lists Contact Info (email), User Content, Location, and Identifiers (push token) as collected, and mark them "not used for tracking."

---

## 5. App Tracking Transparency — ✅ PASS (not required)

- No cross-app/advertising tracking SDKs, no IDFA/`AdvertisingIdentifier`, and no `expo-tracking-transparency` dependency (repo-wide search returned nothing relevant).
- The published policy explicitly states no third-party analytics/ad tracking: `paddles-up-privacy/index.html:69`.
- ATT permission is therefore **not needed**. (Matches `APP_STORE_AUDIT_CHECKLIST.md:36`.)

---

## 6. Minimum Functionality / Completeness (Guidelines 2.1 / 4.2) — ⚠️ NEEDS ATTENTION

### Placeholder / dev / debug UI — ✅ PASS
- No "Coming soon", stubbed screens, or disabled feature buttons found. Every "placeholder" hit is a legitimate `TextInput placeholder`/avatar/skeleton (e.g. `app/(tabs)/settings.tsx`, `components/court-detail-skeleton.tsx`).
- `console.*` calls are confined to `lib/` helpers, Edge Functions, and `__DEV__`-guarded branches (`app/_layout.tsx:59,104,109,188,197`, `components/app-error-boundary.tsx:21-23`) — none render into the UI.
- Admin-only UI is gated by `players.admin` (`app/(tabs)/settings.tsx:750-758`); no hardcoded test/admin accounts (`APP_STORE_AUDIT_CHECKLIST.md:33`).

### Reviewer / demo account — ⚠️ NEEDS ATTENTION
- The entire app is behind email/password login, and **no demo/reviewer test-account credentials are documented** anywhere (README, comments, or metadata files — `README.md` is the default Expo template).
- **Suggested fix:** Create a stable reviewer account (with sample courts/friends/data visible) and enter its credentials in the App Store Connect "App Review Information" section; optionally note it in the repo for future submissions.

---

## 7. Location Usage Justification — ✅ PASS

- **Foreground / when-in-use only.** All calls use `requestForegroundPermissionsAsync` and `getCurrentPositionAsync` / `watchPositionAsync` while the app is open: `app/(tabs)/index.tsx:284,291,340,379,388,668-670`, `app/court/[id].tsx:333`. Accuracy is `Balanced`/`High`, not continuous high-precision background tracking.
- **No background location:** no `requestBackgroundPermissionsAsync`, no `startLocationUpdatesAsync`, no background location task; Android requests only `ACCESS_COARSE/FINE_LOCATION` (`app.json:35-38`); the `expo-location` plugin declares only `locationWhenInUsePermission` (`app.json:47-52`).
- Justification is tied to core functionality: showing nearby courts and verifying court proximity for check-in/availability (`lib/location-permissions.ts:2-3`). No extra background-location review scrutiny should apply.

---

## 8. Export Compliance — ✅ PASS

- `ITSAppUsesNonExemptEncryption: false` is set: `app.json:17`. This lets the build skip the export-compliance questionnaire.
- All network traffic is standard HTTPS/TLS to Supabase and Google Maps; **no custom or non-standard encryption** is implemented anywhere in the codebase. This declaration is accurate.

---

## 9. Contact & Support Info — ⚠️ NEEDS ATTENTION

- In-app there is a "Send Feedback" row that opens `mailto:dawsonhanks@gmail.com`: `app/(tabs)/settings.tsx:70`, plus the Privacy Policy link. There is **no dedicated support URL** surfaced in-app, and the contact is a personal Gmail rather than a branded support address.
- The stale `privacy.html` at repo root has a wrong/mismatched contact email vs. the live policy page (`APP_STORE_AUDIT_CHECKLIST.md:18`), which could confuse a reviewer if that file is ever served.
- Apple requires a support URL and marketing/contact info in App Store Connect metadata; in-app is best practice.
- **Suggested fix:** Add a support URL and a stable support email in App Store Connect, ideally surface both on an in-app About/Support row, and remove or fix the stale `privacy.html` so only the correct contact remains.

---

## 10. Crash / Error Handling — ✅ PASS

- App-wide error boundary wraps the whole tree with a user-facing "restart" fallback: `components/app-error-boundary.tsx`, mounted at `app/_layout.tsx:212-242`.
- Missing Supabase config renders a graceful config screen instead of crashing: `app/_layout.tsx:207-209`, `components/supabase-config-error.tsx`, `supabase.ts:44`.
- Core flows handle failures: map/location permission-denied and errors are caught (`app/(tabs)/index.tsx:284-389`), court detail wraps location/notification calls in try/catch (`app/court/[id].tsx`), and async DB calls funnel errors through `userFriendlyFromUnknown()` with user-visible banners/alerts.
- Offline state is surfaced (`components/persistent-offline-banner.tsx`, `contexts/network-status-context.tsx`) and realtime/location subscriptions are cleaned up on unmount (`APP_STORE_AUDIT_CHECKLIST.md:38`).
- Deep-link/notification handlers are guarded with try/catch (`app/_layout.tsx:126-205`).

> Minor (not a blocker): several silent-failure query paths (match history, game posts, public profile, friends search) are noted in `APP_STORE_AUDIT_CHECKLIST.md:16-17`. These degrade to empty states rather than crashing, so they are not review blockers, but adding explicit error handling would improve robustness.

---

## Action list for Dawson (❌ / ⚠️ only)

1. **❌ (2.c) Terms of Use / EULA:** publish a terms page with a zero-tolerance clause for objectionable content/abusive users and link it at sign-up + in Settings.
2. **⚠️ (2.d) Report review path:** wire up the orphaned `admin/reports.tsx` screen or document a monitored abuse email / dashboard review workflow.
3. **⚠️ (4.a) Privacy manifest:** add `ios.privacyManifests` declaring collected data types + required-reason APIs, consistent with ASC labels.
4. **⚠️ (4.c) Privacy labels:** complete the ASC privacy questionnaire (email, user content, location, push token; none used for tracking).
5. **⚠️ (6) Reviewer account:** create demo credentials and add them to App Store Connect App Review Information.
6. **⚠️ (9) Support info:** add a support URL + stable support email in ASC (and ideally in-app); fix/remove the stale `privacy.html` contact.
