# Manga chapter tracking

How Media Tracker tracks per-chapter manga release dates, and how users choose
between scanlation and official-translation release streams.

## Goal

For a followed manga, tell the user when the next chapter releases — and let
them choose, **per title**, whether "next chapter" means the **scanlation** or
the **official English (simulpub)** release. These are two different streams
with different dates and sources.

## Locked decisions

| Decision | Choice |
|---|---|
| Who chooses the stream | **Per-title**, with a **global default** for new follows |
| What "official" means | **Official English simulpub chapters** (Manga Plus / VIZ), not volumes |
| Primary data source | **MangaDex API** (`api.mangadex.org`) |

## Current scope (v1): official releases only

To keep the first version simple and reliable, **v1 tracks official English
release dates only**. Official simulpub dates are scheduled and exact, so this
drops all the hard, fragile machinery scanlation tracking needs:

- **No estimation** (cadence, median-gap, snap-to-weekly, fixed-time) — official
  dates are known, not predicted.
- **No scanlation-vs-official toggle / per-title stream choice** yet.
- **No specific-group scraping** (TCB, etc.).

The two-stream model, the estimation algorithm, and the per-title toggle
described below are **deferred to a later phase** — kept here as the design of
record for when we add them.

### Sourcing official dates (v1)
- Where a title has official chapters on MangaDex (external Manga Plus / VIZ
  links), use `externalUrl` + `includeFuturePublishAt` to read the next
  *scheduled* chapter date exactly.
- **Known gap:** the biggest licensed titles (One Piece, Jujutsu Kaisen, …) are
  removed from MangaDex by publisher takedown, so even their official links may
  be absent there. For those, a later fallback is the publisher's weekly simulpub
  schedule (WSJ cadence + announced breaks). v1 accepts reduced coverage for
  these specific titles rather than building the fallback now.

### Model impact (v1)
Because "next official chapter" is a single upcoming date, v1 can reuse the
existing `MediaItem.releaseDate` (holding the next chapter's date) with the
chapter number in `subtitle`. So the richer `MangaPayload` described below is
**not required for v1** — it becomes necessary only when we add the second
(scanlation) stream and per-chapter history.

---

## The two-stream model (future)

Each followed manga has up to two independent chapter streams:

| Stream | Source | Cadence | Availability |
|---|---|---|---|
| **Scanlation** | Fan groups, hosted on MangaDex | Fast, irregular | Even for unlicensed titles |
| **Official** | Manga Plus / VIZ simulpub (external links on MangaDex) | Often same-day as Japan, weekly | Only for licensed titles |

Each stream has its own recent-chapter history and its own predicted next date.
The user's per-title choice selects which stream drives **notifications** and the
**Upcoming** entry for that title.

## Data source: MangaDex API (verified)

Read-only, free, no API key. Relevant endpoints/fields confirmed against
https://api.mangadex.org/docs/ :

- **Search manga:** `GET /manga?title={q}&limit=…`
- **Chapter feed:**
  `GET /manga/{id}/feed?translatedLanguage[]=en&order[publishAt]=desc&limit=100&includeExternalUrl=1&includeFuturePublishAt=1`
- Chapter attributes used: `chapter`, `volume`, `title`, `translatedLanguage`,
  `externalUrl`, `publishAt`, `readableAt`, `pages`.

Two parameters matter a lot:
- **`includeExternalUrl=1`** — include official chapters (they're external links).
- **`includeFuturePublishAt=1`** — include chapters scheduled in the future.
  This is how we can get a *real* (not estimated) next official date when the
  publisher schedules ahead. (Default behavior filters to `publishAt <= NOW()`.)

### Partitioning official vs scanlation

From one chapter feed, split by `externalUrl`:
- **`externalUrl != null`** (points to Manga Plus / Bilibili) → **official stream**
- **`externalUrl == null`** (hosted on MangaDex, has `pages`) → **scanlation stream**

> Verify-at-build: not every external link is guaranteed to be an official
> English simulpub; we may also check the chapter's scanlation group for an
> `official` flag and/or filter known official groups. Treat `externalUrl` as the
> primary signal, group metadata as a tiebreaker.

## Predicting the next chapter (per stream)

- **Official stream:** first try the **scheduled** future chapter from
  `includeFuturePublishAt`. If present → real date, high confidence. Otherwise,
  anchor to the simulpub weekly cadence (most are weekly).
- **Scanlation stream:** infer cadence from the gaps between recent `publishAt`
  timestamps (e.g. median gap), project `lastChapter + medianGap`. Always mark as
  an **estimate**.
- **Hiatus handling:** if a predicted date passes with no new chapter detected,
  mark the stream "on break / schedule unknown" instead of showing a stale date.

## Model additions

This feature requires the richer per-type payload (previously deferred):

```
MangaPayload
├── scanlation: ChapterStream?
└── official:   ChapterStream?

ChapterStream
├── recentChapters: [ChapterRelease]
├── estimatedNext:  EstimatedRelease?
└── sourceLabel:    String          // "MangaDex scanlation", "Manga Plus", …

ChapterRelease
├── chapterNumber: String           // String! chapters can be "142.5"
├── title:         String?
├── publishedAt:   Date
├── language:      String
├── groupName:     String?
└── url:           URL?

EstimatedRelease
├── date:       Date
├── confidence: Confidence          // scheduled | estimated | unknown
└── basis:      String?             // "weekly simulpub", "median gap 7d"
```

On the user's local follow record (`FollowedMedia`, SwiftData):
- add `trackedStream: String` — `"scanlation"` | `"official"`.
Global default lives in Settings (`UserDefaults`).

## Backend pieces

- **`MangaDexAdapter`** conforming to `MediaSource` (search + details), producing
  a `MediaItem` whose `payload` is a `MangaPayload` with both streams populated.
- **Poller integration:** for each followed manga, fetch the feed, and for the
  user's chosen stream, detect a chapter number not seen before → push
  "Chapter N is out." The chosen stream's `estimatedNext` feeds Upcoming.

## UI

- Manga **Detail sheet**: a segmented control ("Scanlation ⇄ Official") that sets
  `trackedStream`. Show *both* streams' next dates; only the chosen one is tracked.
- Disable/show "No official English release" when the official stream is empty.
- **Settings**: global default stream for new manga follows.

## Edge cases

- **No official English license:** official stream empty → disable that option.
- **Takedowns (big titles missing from MangaDex):** scanlation stream may be
  unavailable; official stream may still resolve via Manga Plus cadence.
- **Estimates must look like estimates:** show "~" / "estimated" so users don't
  treat an inferred date as a guarantee.
- **Language:** start with English (`translatedLanguage[]=en`); other languages
  later.

## Verify-at-build checklist

- [ ] Confirm `externalUrl`-based official/scanlation split holds across sample titles.
- [ ] Confirm `includeFuturePublishAt` actually returns scheduled official chapters.
- [ ] Check whether the scanlation-group `official` flag is needed as a tiebreaker.
- [ ] Confirm MangaDex rate limits and required attribution/usage terms.
- [ ] Evaluate MangaUpdates / Manga Plus cadence as fallbacks for missing titles.

## Build order

1. Build the `payload` / `MangaPayload` model (backend + client) — the foundation.
2. `MangaDexAdapter`: search + feed + partition + per-stream prediction.
3. `trackedStream` on the follow record + global default in Settings.
4. Detail-sheet segmented control + Upcoming/poller using the chosen stream.
