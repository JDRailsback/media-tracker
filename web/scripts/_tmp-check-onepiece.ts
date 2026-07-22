import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { db } from "../lib/db";
import { searchDeezerArtists } from "../lib/sources/deezer";

async function main() {
  const sql = db();
  const catalogHits = await sql`SELECT id, title, popularity_score FROM catalog_items WHERE type = 'artist' AND title ILIKE '%one piece%'`;
  console.log("catalog artist rows:", JSON.stringify(catalogHits, null, 2));

  const live = await searchDeezerArtists("one piece", 15);
  console.log("live deezer results:", JSON.stringify(live.map((a) => ({ name: a.name, nb_fan: a.nb_fan, nb_album: a.nb_album })), null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
