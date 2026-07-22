# Full Notifications System — History Page + Customizable Alerts

Status: **implemented** (see refinements noted inline — the shipped version differs from the
original draft in four places: `/api/prefs` is POST-only so push-endpoint capability URLs never
land in query strings/logs; the client does a one-time backfill of pre-existing localStorage
follows so they gain server rows; push payloads deep-link to `/?view=notifications`; and the
history view reuses the Home feed's existing `freshById` item resolution instead of a second
batch fetch.)

## Context

Trackr currently has one notification mode: a daily cron (`/api/poll`) that detects when a followed item's release date changes and pushes a single generic alert to every subscribed device. There's no record of what was ever sent, no way to quiet a specific noisy title without unfollowing it, no per-type control (e.g. "stop pinging me for manga"), and no way to get a heads-up before release day rather than the day it changes.

The goal: a **sidebar page listing notification history**, plus **customizable alerts** — confirmed as (1) **per-item mute** (stop pushes for one followed thing, keep tracking it) + **per-media-type mute**, and (2) **lead-time reminders** ("also remind me N days before") layered on top of today's day-of/date-change trigger, not replacing it.

A real architectural gap surfaced during research: `followed_items` rows are only ever created via `POST /api/follow`, and `lib/push-client.ts`'s `syncFollow()` silently no-ops whenever push isn't enabled. That means today, following something *without* push enabled leaves **zero server-side trace** — the poll cron never sees it, and enabling push later doesn't backfill it. Since history needs to work even for someone who's never turned on push, this plan includes the small fix that makes that possible (see step 2).

## Approach

### 1. Schema (`web/lib/db.ts`, inside `buildSchema()`)

```sql
-- One global row per logged event (mirrors followed_items' "one row per item" model).
CREATE TABLE IF NOT EXISTS notification_history (
  id SERIAL PRIMARY KEY,
  followed_item_id INTEGER NOT NULL REFERENCES followed_items(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,              -- denormalized, so GET /api/notifications?ids= needs no join
  event_type TEXT NOT NULL,           -- 'change' | 'reminder'
  lead_days INTEGER NOT NULL DEFAULT -1,  -- sentinel, NOT NULL: Postgres UNIQUE treats NULL as
                                       -- always-distinct, which would defeat idempotency below
  release_date DATE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  message TEXT NOT NULL,              -- frozen body text, so history reads correctly even if the
                                       -- item's title/subtitle changes later
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (followed_item_id, event_type, release_date, lead_days)
);
CREATE INDEX IF NOT EXISTS notification_history_item_idx ON notification_history (item_id);

-- Per-item mute (per DEVICE — a phone and a laptop are different subscriptions).
ALTER TABLE subscription_follows ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT false;

-- Per-subscription type-mute + lead-time.
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS muted_types JSONB NOT NULL DEFAULT '[]';
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NOT NULL DEFAULT 0;
```

`muted_types` holds `MediaType` strings — **including `"franchise"`**, confirmed followable the same way via `app/collection/[slug]/page.tsx`'s `syncFollow` calls (label "Collection" in `components/TypeTag.tsx`). `lead_time_days = 0` = reminders off; one scalar per subscription (not a set), matching a single `<select>`.

Idempotency: `INSERT ... ON CONFLICT (...) DO NOTHING RETURNING id` — a `NULL` return means "already logged," so push only fires on a genuine first insert. Keying on `release_date` (not "today") means a rescheduled release correctly gets a fresh reminder rather than staying suppressed.

### 2. Fix push-less follows (`web/app/api/follow/route.ts`, `web/lib/push-client.ts`)

`POST /api/follow` currently 400s without a `subscription`. Make it optional: always upsert `followed_items`; only touch `push_subscriptions`/`subscription_follows` when a subscription is supplied. Then in `push-client.ts`, change `syncFollow(itemID, true)` to always POST (`subscription: sub ?? null`), dropping the early return for the follow case only — `syncFollow(itemID, false)` keeps its current no-op-without-subscription behavior (nothing to unlink server-side either way). This is what makes "history works even without push enabled" true.

### 3. Poll route rewrite (`web/app/api/poll/route.ts`)

Per followed-item loop, inside the existing try/catch (unchanged resilience — one bad item never aborts the run):

1. Existing day-of/change detection stays as-is (fetch, compare, update `last_known_release_date`).
2. Pull this item's subscribers with their prefs in one query (join `push_subscriptions`+`subscription_follows`), filter to `eligible = !item_muted && !muted_types.includes(item.type)`.
3. **Change event**: on the existing `changed && !firstCheck` condition, `INSERT ... ON CONFLICT DO NOTHING RETURNING id` into `notification_history` (`event_type: 'change'`, `lead_days: -1`) — logged **unconditionally**, even with zero eligible subscribers (so history is complete regardless of push state). Push only fires if the insert actually happened, to every `eligible` subscription.
4. **Reminder event**: independent of whether the date changed this run — if `newDate` exists, compute `diffDays` via `daysBetween` (export it from `lib/feed.ts`, currently private) between today and the release date. Collect the distinct `lead_time_days > 0` values among `eligible` subscribers; for each that equals `diffDays`, insert a `'reminder'` row (same idempotency pattern) and push only to the subscriptions whose `lead_time_days` matches that specific value.

Reuse `describeRelease` (`lib/feed.ts`, already exported) for message phrasing instead of hand-rolling date strings. No new cron entry — this rides inside `/api/poll`'s existing invocation; Vercel Hobby's 2-cron-job limit is already fully spent on `/api/poll` + `/api/cron/daily` (`vercel.json`).

### 4. New/changed API routes

- **`web/app/api/notifications/route.ts`** (new) — `GET ?ids=movie:603,artist:12246` → `notification_history WHERE item_id = ANY(ids)`, `ORDER BY created_at DESC`, capped ~200. Same no-auth, filter-by-client-supplied-ids trust model as `/api/followed`.
- **`web/app/api/mute/route.ts`** (new) — `POST { itemID, subscription, muted }`: same upsert chain as `/api/follow` (a subscription might be enabled after already following), then `UPDATE subscription_follows SET muted = $muted`.
- **`web/app/api/prefs/route.ts`** (new) — `GET ?endpoint=` → `{ mutedTypes, leadTimeDays, mutedItemIds }` (`mutedItemIds` sourced from that subscription's `subscription_follows.muted = true` rows — how `DetailModal`/artist page know an item's current mute state). `POST { subscription, mutedTypes?, leadTimeDays? }` → upsert `push_subscriptions` (same `ON CONFLICT (endpoint)` shape as `/api/subscribe`), update whichever fields were passed.

### 5. Client

- **`web/lib/notificationHistory.ts`** (new) — read/unread tracker mirroring `hiddenCategories.ts`'s localStorage-array pattern, capped at 500 (unbounded growth unlike the small fixed content-filter set): `getReadIds()`, `markRead(ids)`.
- **`web/lib/notificationPrefs.ts`** (new) — `LEAD_TIME_OPTIONS = [0, 1, 3, 7, 14]`, a `MUTABLE_TYPES` list reusing `TypeTag.tsx`'s labels.
- **`web/lib/push-client.ts`** — export `currentSubscription()`; add `getPrefs()`, `setMutedTypes()`, `setLeadTimeDays()`, `setItemMuted()`.
- **`web/components/Sidebar.tsx`** — extend `View` with `"notifications"`, add a `Bell` nav entry before Settings, add an `unreadCount?: number` badge prop.
- **`web/app/page.tsx`** — fetch notification history + batch-resolve live item data (reusing the existing `/api/followed?ids=` pattern) once on mount, independent of which view is active, so the Sidebar badge is always accurate. New `view === "notifications"` branch rendering rows (live poster/title when resolvable, frozen `message` as fallback), marking read on open. Settings view gains a lead-time `<select>` and mounts the new type-mute component, in the existing `rounded-2xl bg-surface ring-1 ring-hairline` block style.
- **`web/components/TypeMutes.tsx`** (new) — mirrors `ContentFilters.tsx` exactly (pill buttons, `onChange` callback), toggling `muted_types` instead of hidden categories.
- **`web/components/DetailModal.tsx`** and **`web/app/artist/[id]/page.tsx`** — a small bell/bell-off icon next to the existing Follow button, shown only once followed AND a push subscription exists, calling `setItemMuted`.

### Explicitly out of scope
No mute affordance on the compact Following-list rows (detail views cover the real need at much lower complexity). No per-item lead-time (one scalar per subscription only). No `sw.js` changes needed. No cross-device read-state sync. No history backfill before ship. No new cron job, no email/SMS channel.

## Verification (once implemented)

1. `npx tsc --noEmit`.
2. Manually trigger `/api/poll` locally (bearer `CRON_SECRET` if set) against a followed item with a manipulated `last_known_release_date`/`lead_time_days` to confirm exactly one `change` row and/or one `reminder` row is inserted per event, never duplicated on a second run the same day.
3. In the browser: follow an item **without** enabling push, confirm a `followed_items` row now exists (previously it wouldn't have); enable push, set a lead-time and mute a type, follow/mute an item via the DetailModal bell, and confirm `/api/prefs` reflects it.
4. Open the new Notifications sidebar page, confirm history rows render with live poster/title where resolvable, unread badge clears on open, and muted items/types stop generating pushes on the next simulated poll run while still appearing in history.
