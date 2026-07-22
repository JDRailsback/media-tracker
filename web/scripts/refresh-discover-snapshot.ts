// Standalone CLI — runs just stage E of /api/cron/daily (rebuilding
// discover_snapshot from whatever's currently in trending_items/
// upcoming_items/catalog_items/collections) without running the full daily
// cron. Useful for populating/refreshing the snapshot locally. Not part of
// any live request path; run manually: `npm run refresh-discover-snapshot`.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { refreshDiscoverSnapshot } from "../lib/sources";

async function main() {
  process.stdout.write("Rebuilding discover_snapshot... ");
  await refreshDiscoverSnapshot();
  console.log("done");
}

main().then(() => process.exit(0));
