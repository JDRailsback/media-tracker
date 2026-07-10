import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

const override = await sql`SELECT slug, name FROM collection_overrides WHERE slug = 'game-of-thrones'`;
console.log("override row:", override.length === 0 ? "none (uses static seed)" : override);

const members = await sql`SELECT c.title, c.type FROM collection_items ci JOIN catalog_items c ON c.id = ci.item_id WHERE ci.collection_slug = 'game-of-thrones'`;
console.log("members:", members);
