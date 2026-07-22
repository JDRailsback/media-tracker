// Standalone CLI — runs just stage E of /api/cron/daily (rebuilding
// upcoming_calendar from whatever's currently in upcoming_items/
// catalog_items) without running the full daily cron. Useful for
// populating/refreshing the calendar locally. Not part of any live request
// path; run manually: `npm run refresh-upcoming-calendar`.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { refreshUpcomingCalendar } from "../lib/upcomingCalendar";

async function main() {
  process.stdout.write("Rebuilding upcoming_calendar... ");
  const { count } = await refreshUpcomingCalendar();
  console.log(`done (${count} rows)`);
}

main().then(() => process.exit(0));
