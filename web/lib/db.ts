import { neon, NeonQueryFunction } from "@neondatabase/serverless";

// Lazy Neon client so a missing DATABASE_URL doesn't crash at build time.
let client: NeonQueryFunction<false, false> | null = null;

export function db(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // cache: "no-store" is CRITICAL, not an optimization tweak. Neon's HTTP
    // driver issues every query as a POST fetch — and Next 14's Data Cache
    // caches POST fetches made inside GET route handlers, keyed by URL +
    // body (query text + params). Without this, a query result gets frozen
    // the first time that exact (query, params) pair runs and is served
    // stale forever after — even across server restarts (the cache persists
    // in .next). Verified live: a row inserted later was permanently
    // "missing" through one call site while identical inline SQL saw it.
    client = neon(url, { fetchOptions: { cache: "no-store" } });
  }
  return client;
}

// Create tables if they don't exist (Neon's HTTP driver runs one stmt per call).
let schema: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schema) {
    // The cached promise must be CLEARED if it rejects — otherwise one
    // transient DB failure at first touch (verified live: the Neon quota
    // outage) poisons this module instance for the server's whole lifetime,
    // and every read that awaits ensureSchema() silently returns null/[]
    // forever after the DB is healthy again. Symptom was maddening: some
    // routes permanently "Not found" while freshly-compiled routes worked.
    schema = buildSchema().catch((err) => {
      schema = null;
      throw err;
    });
  }
  return schema;
}

function buildSchema(): Promise<void> {
  return (async () => {
      const sql = db();
      await sql`CREATE TABLE IF NOT EXISTS followed_items (
        id SERIAL PRIMARY KEY,
        item_id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        last_known_release_date TIMESTAMPTZ,
        last_checked_at TIMESTAMPTZ
      )`;
      await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS subscription_follows (
        subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
        followed_item_id INTEGER NOT NULL REFERENCES followed_items(id) ON DELETE CASCADE,
        PRIMARY KEY (subscription_id, followed_item_id)
      )`;
      // Migrate the old table name on installs that still have it. Must run
      // before CREATE-IF-NOT-EXISTS so the old data survives. Wrapped in
      // try/catch because: (a) the old table may not exist (fresh install,
      // no-op), or (b) collection_overrides already exists from a previous
      // run (rename would fail — just continue).
      try {
        await sql`ALTER TABLE franchise_overrides RENAME TO collection_overrides`;
      } catch { /* already migrated or never existed */ }
      // Manual overrides for the curated collections in lib/collections.ts,
      // plus brand-new collections created entirely through the editor
      // (is_custom = true, no static entry to fall back to). A row here is a
      // COMPLETE replacement definition, not a sparse per-field patch — once
      // any field is edited, this row becomes the sole source of truth for
      // that slug, which avoids null-vs-"not overridden" ambiguity.
      await sql`CREATE TABLE IF NOT EXISTS collection_overrides (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tagline TEXT,
        theme_primary TEXT NOT NULL,
        theme_secondary TEXT NOT NULL,
        poster_url TEXT,
        banner_url TEXT,
        logo_url TEXT,
        page_background TEXT,
        color_scheme TEXT,
        queries JSONB NOT NULL DEFAULT '{}',
        movie_collection_id INTEGER,
        featured BOOLEAN NOT NULL DEFAULT false,
        include_overrides JSONB NOT NULL DEFAULT '[]',
        exclude_ids JSONB NOT NULL DEFAULT '[]',
        is_custom BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`;
      // The table already exists in production with rows in it, so a plain
      // CREATE TABLE IF NOT EXISTS above won't add these two new columns to
      // it — ALTER is needed for anyone who already has the old schema.
      await sql`ALTER TABLE collection_overrides ADD COLUMN IF NOT EXISTS logo_url TEXT`;
      await sql`ALTER TABLE collection_overrides ADD COLUMN IF NOT EXISTS page_background TEXT`;
      await sql`ALTER TABLE collection_overrides ADD COLUMN IF NOT EXISTS color_scheme TEXT`;
      // Bulk-populated catalog of established (already-released) titles —
      // filled by scripts/ingest-catalog.ts, not by any live request path.
      // search_vector is a generated column so full-text search never needs a
      // separate write path to stay in sync with title.
      await sql`CREATE TABLE IF NOT EXISTS catalog_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        overview TEXT,
        poster_url TEXT,
        release_date DATE,
        popularity_score INTEGER NOT NULL DEFAULT 0,
        genres JSONB NOT NULL DEFAULT '[]',
        external_links JSONB NOT NULL DEFAULT '[]',
        metadata JSONB NOT NULL DEFAULT '{}',
        search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title)) STORED,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS catalog_items_search_idx ON catalog_items USING GIN (search_vector)`;
      await sql`CREATE INDEX IF NOT EXISTS catalog_items_type_idx ON catalog_items (type)`;
      // Added after the table's initial rollout — ALTER for anyone who already ran it.
      await sql`ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS external_links JSONB NOT NULL DEFAULT '[]'`;
      // Not-yet-released movies/TV/games — refreshed daily by the
      // /api/cron/upcoming job (see lib/upcoming.ts), NOT by any user
      // request path. Separate from catalog_items because this data churns
      // constantly (dates get confirmed, items release and drop out) while
      // the bulk catalog is a manually-refreshed snapshot.
      await sql`CREATE TABLE IF NOT EXISTS upcoming_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        overview TEXT,
        poster_url TEXT,
        release_date DATE,
        date_confirmed BOOLEAN NOT NULL DEFAULT false,
        popularity_score INTEGER NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}',
        search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title)) STORED,
        first_seen_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS upcoming_items_type_idx ON upcoming_items (type)`;
      // Franchise/studio/keyword identifiers (e.g. "star wars collection",
      // "walt disney pictures", "marvel cinematic universe (mcu)") — a
      // superset of genres, used ONLY for collection matching (see
      // scripts/rebuild-collections.ts), not shown in the UI the way genres
      // are. Existing rows get this backfilled by re-running `npm run ingest`.
      await sql`ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'`;
      // Precomputed collection membership — replaces resolving a
      // collection's contents via a live search on every page load (see
      // resolveCollection in lib/sources/collection.ts). Populated by
      // scripts/rebuild-collections.ts, not any user request path. Full
      // per-slug replace on rebuild, not an incremental upsert — membership
      // sets are small, so this avoids stale-row bookkeeping.
      await sql`CREATE TABLE IF NOT EXISTS collection_items (
        collection_slug TEXT NOT NULL,
        item_id TEXT NOT NULL,
        PRIMARY KEY (collection_slug, item_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS collection_items_slug_idx ON collection_items (collection_slug)`;
      // A collection's single nearest not-yet-released entry, precomputed by
      // matching its curated title list against upcoming_items (see
      // rebuildAllCollections in lib/collections-rebuild.ts) — same
      // table-only-read principle as collection_items, so resolveCollection
      // never joins upcoming_items live. One row per collection (the
      // earliest confirmed date wins); a collection with nothing dated
      // upcoming simply has no row.
      await sql`CREATE TABLE IF NOT EXISTS collection_next_release (
        collection_slug TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        title TEXT NOT NULL,
        poster_url TEXT,
        release_date DATE NOT NULL
      )`;
      // Content-filter signals (see lib/contentFilters.ts, Settings' "Content
      // filters" section) — original_language is TMDB's ISO 639-1 code
      // ("ja", "ko", "en", ...), free on every movie/TV response already
      // being fetched (no extra request). genres already existed on
      // catalog_items; upcoming_items needs its own copy since "Popular
      // upcoming" is filtered the same way. Games/manga have no language
      // concept — original_language stays NULL for them, which the filter
      // predicates account for.
      await sql`ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS original_language TEXT`;
      await sql`ALTER TABLE upcoming_items ADD COLUMN IF NOT EXISTS original_language TEXT`;
      await sql`ALTER TABLE upcoming_items ADD COLUMN IF NOT EXISTS genres JSONB NOT NULL DEFAULT '[]'`;
      // Genuinely-trending-right-now data (see lib/trending.ts) — full
      // replace-on-refresh by the daily cron, distinct from catalog_items'
      // all-time popularity_score. `rank` is the source's own trending
      // order, not a score, so 1 always means "most trending" regardless of
      // how each source's underlying signal is scaled.
      await sql`CREATE TABLE IF NOT EXISTS trending_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        overview TEXT,
        poster_url TEXT,
        release_date DATE,
        rank INTEGER NOT NULL,
        genres JSONB NOT NULL DEFAULT '[]',
        original_language TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS trending_items_type_idx ON trending_items (type)`;
      // Wide landscape artwork for the detail card's hero header (TMDB
      // backdrops, IGDB artworks/screenshots — see MediaItem.backdropURL).
      // Manga rows stay NULL: MangaDex only has portrait covers. Added after
      // each table's initial rollout — ALTER for installs that already ran it.
      await sql`ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS backdrop_url TEXT`;
      await sql`ALTER TABLE upcoming_items ADD COLUMN IF NOT EXISTS backdrop_url TEXT`;
      await sql`ALTER TABLE trending_items ADD COLUMN IF NOT EXISTS backdrop_url TEXT`;
      // "Available on" links for not-yet-released titles — storefront
      // pre-order pages for games (IGDB websites), the title's TMDB page for
      // movies/TV (no watch providers exist pre-release). catalog_items has
      // had this column from the start; upcoming_items simply never did, so
      // an upcoming title's detail card had nothing to link to.
      await sql`ALTER TABLE upcoming_items ADD COLUMN IF NOT EXISTS external_links JSONB NOT NULL DEFAULT '[]'`;
  })();
}
