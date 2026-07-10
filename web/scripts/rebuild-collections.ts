// Standalone CLI wrapper around lib/collections-rebuild.ts — resolves each
// collection's hand-curated title lists (see lib/collections.ts `curated`)
// into the collection_items table. Run after editing a curated list:
// `npm run rebuild-collections`. The daily cron
// (app/api/cron/daily/route.ts) runs the same rebuild automatically so
// titles missing from the catalog self-heal once an ingest adds them.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { rebuildAllCollections } from "../lib/collections-rebuild";

async function main(): Promise<void> {
  const summary = await rebuildAllCollections();
  for (const c of summary.collections) {
    if (c.custom) {
      console.log(`\n=== ${c.slug} === (custom — manual includes only, cleared precomputed rows)`);
      continue;
    }
    console.log(`\n=== ${c.slug} ===`);
    const lines: string[] = [];
    for (const t of c.perType) {
      lines.push(`${t.type}: ${t.matched}/${t.total}`);
      if (t.unmatched.length > 0) lines.push(`  NOT FOUND (${t.type}): ${t.unmatched.join(", ")}`);
    }
    console.log(lines.length > 0 ? `  ${lines.join("\n  ")}` : "  (no curated titles)");
  }
  console.log(`\nDone. ${summary.totalItems} items across static collections; ${summary.totalUnmatched} titles unmatched.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
