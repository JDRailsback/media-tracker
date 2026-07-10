import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

// Nickelodeon is now a first-class static collection (slug "nickelodeon" in
// lib/collections.ts) with a full hand-curated list. The interim editor
// override that renamed the old game-of-thrones slug to "Nickelodeon" would
// now surface as a DUPLICATE custom collection — remove it and its
// precomputed rows. Game of Thrones itself was removed per the user's
// replacement of it.
const removed = await sql`DELETE FROM collection_overrides WHERE slug = 'game-of-thrones' RETURNING slug, name`;
await sql`DELETE FROM collection_items WHERE collection_slug = 'game-of-thrones'`;
console.log("removed override:", removed);
