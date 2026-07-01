# Build status & Mac setup

Snapshot of what's implemented, what's deferred, and what to do/verify when the
project moves to a Mac (it's been written on Windows, so nothing has compiled yet).

## What's built

### Backend (Vapor) — `backend/`
- **App skeleton:** `Package.swift`, `entrypoint.swift`, `configure.swift`.
- **Unified model:** `MediaItem` (+ `MediaType`, `ExternalLink`/`LinkKind`).
- **Sources (adapters)** behind the `MediaSource` protocol (`search` + `details`):
  - **TMDB** (movies) — search + details with watch providers (`append_to_response`).
  - **IGDB** (games) — OAuth token flow, POST query body.
  - **MangaDex** (manga) — official chapter date via `externalUrl` + `includeFuturePublishAt`.
- **Routes:** `/`, `/health`, `/search` (per-type + combined), `/item/{type}/{id}`.
- **Database (Fluent + Postgres):** models `FollowedItem`, `Device`, `DeviceFollow`
  + migrations; endpoints `POST /device`, `/follow`, `/unfollow`.
- **Notifications:** `PushService` (APNs seam) + `ReleasePoller` (scheduled every 6h:
  re-fetch → detect release-date change → push to linked devices).
- **Config/secrets:** `.env` (gitignored) / `.env.example`; ISO-8601 JSON dates.

### iOS app (SwiftUI, iOS 17+) — `ios/MediaTracker/`
- **Shell:** `MediaTrackerApp` (+ SwiftData container + app-delegate adaptor),
  `ContentView` (4 tabs).
- **Core:** client `MediaItem`/`MediaType`/`ExternalLink`; `FollowedMedia` (SwiftData).
- **Networking:** `APIClient` — `search`, `details`, `registerDevice`, `follow`, `unfollow`.
- **Features:** Discover (search + results + detail sheet), Detail (poster, info,
  Follow button, watch links), Library (`@Query`), Upcoming (future releases).
- **Notifications:** `NotificationManager` (permission + local notifications),
  `AppDelegate` (APNs token → `/device`), follow/unfollow wired in `DetailView`.

### Media types supported
Movies, TV (via TMDB search), games, manga (official dates only — see
[MANGA_TRACKING.md](MANGA_TRACKING.md)).

## Deferred / not yet built
- **Rich `MediaItem` `payload`** (type-specific extras, per-episode/chapter lists,
  multi-date). Needed for scanlation manga tracking and richer anime episodes.
- **Manga scanlation stream** + per-title stream toggle (design in MANGA_TRACKING.md).
- **Anime** as a distinct type (AniList adapter).
- **First-follow token reconciliation** (re-sync local follows once APNs token arrives).
- **Production deploy** (Dockerfile, Fly.io, hosted Postgres), token caching (IGDB),
  multi-instance-safe polling, tests.
- **Design polish** to match the reference screenshot (custom detail layout, etc.).

## Mac setup steps (first run)
1. **Accounts/keys:** TMDB API key; Twitch app (IGDB client id + secret); Apple
   Developer Program (for APNs + device testing + TestFlight).
2. **Backend:** install Postgres (or Docker); `cp .env.example .env` and fill in
   `TMDB_API_KEY`, `IGDB_*`, `DATABASE_URL` (APNs vars optional until testing push);
   `swift package resolve`; `swift run App` (auto-migrates in dev).
3. **iOS app:** create a SwiftUI app project named `MediaTracker` in Xcode, add the
   `ios/MediaTracker/` sources, and:
   - Add an **App Transport Security** exception to allow `http://localhost` in dev.
   - Enable **Push Notifications** + **Background Modes → Remote notifications** capabilities.
   - Point `APIClient.baseURL` at the running backend.

## Verify-on-Mac checklist (flagged while writing blind)
- [ ] **APNs config + send API** (`configure.swift`, `PushService.swift`) — most
      version-sensitive; confirm against the installed `vapor/apns`.
- [ ] **NIO scheduling** (`scheduleRepeatedAsyncTask` / `makeFutureWithTask`) in `configure.swift`.
- [ ] **Fluent** query / `@Parent` filter syntax and the Postgres URL config.
- [ ] **MangaDex** `publishAt` parses with `ISO8601DateFormatter` (no fractional seconds);
      `externalUrl` reliably marks official chapters across sample titles.
- [ ] **Date encoding** agreement (backend `.iso8601` ↔ client decoder).
- [ ] **First-follow token race** — decide whether to add reconciliation.
- [ ] APNs generally needs a **physical device**; local notifications work in the simulator.
