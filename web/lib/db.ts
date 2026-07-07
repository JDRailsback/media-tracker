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
      // Manual overrides for the curated franchises in lib/franchises.ts, plus
      // brand-new franchises created entirely through the editor
      // (is_custom = true, no static entry to fall back to). A row here is a
      // COMPLETE replacement definition, not a sparse per-field patch — once
      // any field is edited, this row becomes the sole source of truth for
      // that slug, which avoids null-vs-"not overridden" ambiguity.
      await sql`CREATE TABLE IF NOT EXISTS franchise_overrides (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tagline TEXT,
        theme_primary TEXT NOT NULL,
        theme_secondary TEXT NOT NULL,
        poster_url TEXT,
        banner_url TEXT,
        queries JSONB NOT NULL DEFAULT '{}',
        movie_collection_id INTEGER,
        featured BOOLEAN NOT NULL DEFAULT false,
        include_overrides JSONB NOT NULL DEFAULT '[]',
        exclude_ids JSONB NOT NULL DEFAULT '[]',
        is_custom BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`;
    })();
  }
  return schema;
}
