import { db } from "@/lib/db";

// The last, authoritative step of every ingest into catalog_items or
// upcoming_items: re-applies any manually-pinned release date on top of
// whatever that run just wrote. Exists because TMDB's own release_dates
// data for a movie can be incomplete or simply wrong right around its
// actual release — no fetch-success heuristic can fully guard against
// that (see lib/db.ts's release_date_overrides comment), so once a date is
// confirmed correct here, nothing overwrites it again until the override
// itself is removed.
export async function applyReleaseDateOverrides(): Promise<void> {
  const sql = db();
  await sql`
    UPDATE catalog_items c SET release_date = o.release_date
    FROM release_date_overrides o
    WHERE c.id = o.id AND c.release_date IS DISTINCT FROM o.release_date`;
  await sql`
    UPDATE upcoming_items u SET release_date = o.release_date
    FROM release_date_overrides o
    WHERE u.id = o.id AND u.release_date IS DISTINCT FROM o.release_date`;
}
