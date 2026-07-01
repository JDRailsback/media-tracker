# Data Model

Defines the unified `MediaItem` shape (shared concept across app + backend) and
the SwiftData schema used for local storage. The schema is intentionally
**CloudKit-compatible** so iCloud sync can be enabled later without migration.

## CloudKit-safe rules (apply to every SwiftData model)

CloudKit imposes constraints that SwiftData-only schemas don't. We follow them
from day one so turning on sync is a config change, not a rewrite:

1. **Every stored property is optional or has a default value.** CloudKit has no
   non-null guarantee.
2. **No `@Attribute(.unique)` constraints.** CloudKit doesn't support unique
   constraints; enforce uniqueness in app logic instead.
3. **Every relationship has an explicit inverse** and is optional.
4. **No `.deny`/`.cascade` delete rules that CloudKit can't honor** — prefer
   default/nullify.
5. Enums are stored as their raw (`String`) value, not as the enum type.

> Until sync is enabled these cost us nothing; they just keep the door open.

## Core concept: `MediaItem`

The common shape every source maps into. This is the *transport/domain* shape
(what the backend returns and the app reasons about). Local persistence uses the
SwiftData models below, which mirror it.

```
MediaItem
├── id            String   // our stable id: "{type}:{sourceId}", e.g. "movie:603"
├── type          MediaType
├── sourceId      String   // id within the source API (TMDB/IGDB id)
├── source        String   // "tmdb", "igdb", ...
├── title         String
├── subtitle      String?  // e.g. "2022 · Sci-Fi · Mystery"
├── overview      String?
├── posterURL     URL?
├── backdropURL   URL?
├── status        ReleaseStatus    // upcoming / released / ongoing / cancelled
├── primaryReleaseDate  Date?      // the date we notify on / sort by
├── releaseDates  [DatedRelease]   // platform/region specific dates
├── rating        Double?          // normalized 0–10
├── genres        [String]
├── externalLinks [ExternalLink]   // "available on" providers + deep links
└── payload       MediaPayload     // type-specific extras (see below)
```

### Enums

```
enum MediaType: String {
    case movie, tvShow, game, book, comic, manga,
         album, concert, sportsEvent, awardsShow
}

enum ReleaseStatus: String {
    case upcoming, released, ongoing, cancelled, unknown
}
```

### Supporting types

```
struct DatedRelease {
    var date: Date?
    var label: String?      // "PS5", "US theatrical", "Season 2"
    var platform: String?
    var region: String?
}

struct ExternalLink {
    var provider: String    // "Netflix", "Apple TV", "Steam"
    var logoURL: URL?
    var url: URL            // deep link / web fallback
    var kind: LinkKind      // stream / rent / buy / store / info
}
```

### Type-specific payloads

Only the fields unique to a type. Common fields stay on `MediaItem`.

```
enum MediaPayload {
    case movie(MoviePayload)
    case tvShow(TVShowPayload)
    case game(GamePayload)
    // ... added per phase
}

struct MoviePayload {
    var runtimeMinutes: Int?
    var director: String?
    var cast: [String]
}

struct TVShowPayload {
    var seasonCount: Int?
    var episodeCount: Int?
    var network: String?
    var nextEpisodeDate: Date?
    var showStatus: String?     // "Returning", "Ended"
}

struct GamePayload {
    var platforms: [String]     // "PS5", "PC", ...
    var developer: String?
    var publisher: String?
}
```

## SwiftData schema (local persistence)

The app stores **only what the user follows**, plus their tracking state and
notification prefs. Browsing/search results are transient (fetched from backend,
not persisted). All properties optional/defaulted per the CloudKit rules.

### `FollowedMedia`

```
@Model
final class FollowedMedia {
    // identity (uniqueness enforced in code, NOT via @Attribute(.unique))
    var itemID: String = ""          // "movie:603"
    var type: String = ""            // MediaType raw value
    var sourceId: String = ""
    var source: String = ""

    // cached display snapshot (so Library renders offline)
    var title: String = ""
    var subtitle: String?
    var posterURLString: String?
    var status: String = "unknown"   // ReleaseStatus raw value
    var primaryReleaseDate: Date?
    var lastRefreshed: Date?

    // user tracking state
    var userStatus: String?          // "watching", "planned", "completed", ...
    var dateFollowed: Date = Date()
    var isArchived: Bool = false

    // relationships
    var notificationPrefs: NotificationPreference?   // optional, inverse-paired
    var trackedDates: [TrackedDate]? = []

    init() {}
}
```

> Full details (cast, watch links, etc.) are **not** persisted — they're fetched
> from `/item/{type}/{sourceId}` when the Detail sheet opens. We cache only the
> snapshot needed to render Library + Upcoming offline.

### `TrackedDate`

A specific date the user is tracking for an item (a release, a season premiere,
a game launch on a platform). Drives both the Upcoming timeline and local
notification scheduling.

```
@Model
final class TrackedDate {
    var label: String?               // "Season 2", "PS5 launch"
    var date: Date?
    var platform: String?
    var notificationScheduled: Bool = false

    var item: FollowedMedia?         // inverse of FollowedMedia.trackedDates
    init() {}
}
```

### `NotificationPreference`

Per-item override of the global notification defaults.

```
@Model
final class NotificationPreference {
    var enabled: Bool = true
    var leadTimes: [Int] = [0]       // minutes before release: 0, 1440 (1d), 10080 (1w)
    var item: FollowedMedia?         // inverse of FollowedMedia.notificationPrefs
    init() {}
}
```

### Global settings

Stored outside SwiftData (`UserDefaults` / `@AppStorage`) since they're
device-level, not synced content:

- default lead times
- per-`MediaType` enable/disable (e.g. mute sports)
- APNs registration status

## Backend persistence (Postgres / Fluent) — notification index only

The backend stores just enough to run the change-detection poller and target
pushes. It is **not** the user's library (that's the client + future CloudKit).

```
FollowedItem        (id, type, sourceId, source,
                     lastKnownReleaseDate, lastKnownStatus, lastCheckedAt)

Device              (id, apnsToken, platform, updatedAt)

DeviceFollow        (deviceId, followedItemId)   // many-to-many: who to push
```

Poller flow: for each distinct `FollowedItem`, re-fetch from its source adapter,
diff `lastKnownReleaseDate`/`lastKnownStatus`, and on change push to every
`Device` linked via `DeviceFollow`, then update last-known values.

## ID strategy

- Our canonical id: `"{type}:{sourceId}"` (e.g. `"game:1942"`, `"movie:603"`).
- Stable across app + backend, human-debuggable, and avoids collisions between
  sources that reuse numeric ids.
- Uniqueness enforced in application code (CloudKit forbids unique constraints).
