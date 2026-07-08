import { neon, NeonQueryFunction } from "@neondatabase/serverless";

// Lazy Neon client so a missing DATABASE_URL doesn't crash at build time.
let client: NeonQueryFunction<false, false> | null = null;

export function db(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

// Create tables if they don't exist (Neon's HTTP driver runs one stmt per call).
let schema: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schema) {
    schema = (async () => {
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
    })();
  }
  return schema;
}
