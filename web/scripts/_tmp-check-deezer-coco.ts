import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { searchDeezerArtists } from "../lib/sources/deezer";

async function main() {
  const results = await searchDeezerArtists("coco 2", 15);
  console.log(JSON.stringify(results.map((r) => ({ name: r.name, nb_fan: r.nb_fan })), null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
