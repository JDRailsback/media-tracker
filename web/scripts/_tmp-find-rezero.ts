import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { db } from "../lib/db";
async function main() {
  const sql = db();
  const rows = await sql`SELECT id, title, poster_url FROM catalog_items WHERE title ILIKE '%re:zero%' OR title ILIKE '%life larry%' LIMIT 10`;
  console.log(JSON.stringify(rows, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
