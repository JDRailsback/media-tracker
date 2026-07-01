# Architecture

Media Tracker — an iOS app for following any type of media (movies, TV, games,
books, comics/manga, albums, concerts, sports, awards shows) and tracking
upcoming release dates with customizable push notifications.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Platform | iOS 17+, Swift + SwiftUI | Native Apple styling; unlocks SwiftData + modern navigation |
| Local storage | SwiftData (CloudKit-ready schema) | Offline-first; sync added later as a config flip, not a migration |
| Sync | Local now → CloudKit later | Schema designed CloudKit-safe from day one (see Data Model doc) |
| Backend | Vapor (Swift) + Postgres | One language end-to-end; protects API keys; enables server push |
| MVP media types | Movies/TV (TMDB) + Games (IGDB) | Highest-quality free APIs; proves the unified model |
| Notifications | Local (`UserNotifications`) + server push (APNs) | Local for known dates; server for date *changes* / new announcements |

## System overview

```
┌─────────────┐     HTTPS      ┌──────────────┐   3rd-party APIs   ┌──────────┐
│  iOS app    │ ─────────────► │  Vapor       │ ─────────────────► │  TMDB    │
│  (SwiftUI)  │ ◄───────────── │  backend     │ ◄───────────────── │  IGDB    │
│             │                │              │                    │  ...     │
│  SwiftData  │                │  Postgres    │                    └──────────┘
│  (local)    │                │  + poller    │
└──────┬──────┘                └──────┬───────┘
       │                              │
       │  local notifications         │  APNs push (date changed / new release)
       ▼                              ▼
   iOS scheduler ◄───────────────── APNs
```

**Key principle:** the app never talks to TMDB/IGDB directly. All third-party
access is proxied through our backend so API keys stay server-side and we can
add caching, rate-limit handling, and the change-detection poller in one place.

## The unifying abstraction: `MediaItem` + adapters

Every media type is different, but the app treats them all the same way
(search → follow → track release → notify → link out). Two abstractions make
this possible:

1. **`MediaItem`** — a common shape every source maps into (see DATA_MODEL.md).
2. **`MediaSource` adapter** — one per external API, responsible for mapping
   that API's responses into `MediaItem`. The UI, tracking, and notification
   layers never know which source produced an item.

```
protocol MediaSource {
    var mediaType: MediaType { get }
    func search(_ query: String) async throws -> [MediaItem]
    func details(id: String) async throws -> MediaItem
    func watchLinks(id: String) async throws -> [ExternalLink]  // optional per source
}
```

Adding a new media type later = write one new adapter on the backend + one on
the app. No changes to Library, Upcoming, Detail, or Notifications.

## iOS app layers

```
ios/
├── Core/            MediaItem model, MediaSource protocol, SwiftData schema
├── Sources/         TMDBAdapter, IGDBAdapter (API JSON → MediaItem)
├── Networking/      Client for OUR backend (not 3rd-party APIs)
├── Features/
│   ├── Library/     Followed items, filter by type, sort by next release
│   ├── Discover/    Search across enabled sources
│   ├── Upcoming/    Cross-media timeline of releases you follow
│   ├── Detail/      The tappable .sheet — metadata, status, watch links, follow/notify
│   └── Settings/    Notification defaults, per-type toggles
└── Notifications/   Local scheduling + APNs registration
```

- **Networking** layer hits our backend's `/search`, `/item`, etc. The
  `Sources/` adapters live here too because they parse the (proxied) API
  payloads. (Alternatively, parsing happens server-side and the app receives
  pre-mapped `MediaItem` JSON — see "Mapping location" below.)

### Mapping location: app vs backend

Two valid options for where API-JSON → `MediaItem` happens:

- **(A) Backend maps**, app receives clean `MediaItem` JSON. *Recommended.*
  Pros: app is dumb/stable; changing an API only touches the backend; smaller
  app payloads. Cons: backend does more work.
- **(B) Backend proxies raw**, app maps. Pros: thinner backend. Cons: API
  changes force app updates (slow via App Store review).

**We will use (A).** The `MediaSource` adapter protocol lives on the **backend**;
the app's `Sources/` folder shrinks to lightweight Codable models matching our
own `MediaItem` JSON.

## Backend layers (Vapor)

```
backend/
├── Sources/App/
│   ├── Routes/          /search, /item, /follow, /unfollow, /device
│   ├── Sources/         MediaSource protocol + TMDBAdapter, IGDBAdapter
│   ├── Clients/         Raw HTTP clients for TMDB / IGDB (keys injected here)
│   ├── APNs/            Push sender
│   ├── Jobs/            Release-change poller (scheduled)
│   └── Models/          Fluent models (FollowedItem, Device, ...)
└── Migrations/
```

### Endpoints (v1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/search?q=&type=` | Search one or all enabled sources |
| GET | `/item/{type}/{sourceId}` | Full details + watch links |
| POST | `/follow` | Register a followed item (so the poller watches it) |
| POST | `/unfollow` | Stop watching |
| POST | `/device` | Register/refresh an APNs device token |
| GET | `/upcoming?ids=` | Batched release info for the timeline (optional optimization) |

> Note: in the local-only phase the app's source of truth is SwiftData. The
> backend's `FollowedItem` table exists so the **poller** knows what to watch
> and which devices to push. It is a notification index, not the user's library.
> When CloudKit sync lands, the client library remains authoritative.

### Release-change poller

A scheduled job (Vapor Queues / cron, every few hours):

1. Read distinct followed `(type, sourceId)` pairs from Postgres.
2. Re-fetch each from its source adapter.
3. Diff `releaseDate` / status against last-known stored value.
4. On change (date moved, new season announced, now released) → enqueue APNs
   push to all devices following that item.
5. Update stored last-known values.

## Notifications

- **Local (`UserNotifications`):** when a user follows an item with a known
  release date, schedule a local notification. Per-item lead time
  (at release / 1 day / 1 week before) + global defaults + per-type toggles.
- **Server (APNs):** poller-driven pushes for date changes and new releases —
  things the device couldn't know about on its own.
- Device registers its APNs token via `POST /device`; backend maps
  device → followed items for targeting.

## Watch / external links

The Detail sheet shows "available on" providers (the JustWatch row in the
reference screenshot). For movies/TV, TMDB exposes watch-provider availability
(JustWatch-powered). Each `MediaItem` carries `externalLinks: [ExternalLink]`
(provider name, logo, deep link). Sources without provider data simply return
an empty list.

## Build phases

- **Phase 0 — Foundation.** Vapor + Postgres deployed with `/search` proxying
  TMDB. Core `MediaItem` model + CloudKit-safe SwiftData schema. 4-tab app
  shell. One end-to-end vertical slice: search movie → detail sheet → follow →
  appears in Library → local notification scheduled.
- **Phase 1 — MVP.** Add IGDB games. Upcoming timeline. Watch-provider links.
  Backend poller + APNs. TestFlight.
- **Phase 2 — Breadth.** Books, music, comics/manga adapters, one at a time.
- **Phase 3 — Long tail + sync.** Concerts (location-aware), sports schedules,
  curated awards-show data. Flip on CloudKit sync.

## External accounts / keys needed

- TMDB API key (free)
- IGDB / Twitch developer app (free, needs Twitch account)
- Apple Developer Program ($99/yr — APNs, device testing, TestFlight)
- Backend host (Fly.io recommended) + Postgres

## Known risk areas

- **Awards shows:** no clean public API; will require a small hand-curated
  dataset served from our backend.
- **Manga release tracking:** messy/irregular; AniList is the best source.
- **Rate limits:** TMDB/IGDB both throttle; backend caching mitigates.
- **SwiftData maturity:** if complex queries hit limits, the fallback is Core
  Data — keep the persistence layer behind a repository interface so the swap
  is contained.
