// Normalizes a Postgres DATE column into a plain "YYYY-MM-DD" string,
// regardless of whether the driver hands it back as a string or a JS Date.
//
// The Date-object case is the one that mattered: Neon's driver returns a
// DATE column as `new Date(year, month, day)` — LOCAL midnight, not UTC
// midnight. Calling `.toISOString()` on that (the previous behavior, in
// four separate copies of this same function) re-serializes THROUGH UTC,
// which bakes in the server's timezone offset (verified live: local
// midnight in US Eastern time became "...T05:00:00.000Z", 5 hours into the
// NEXT day by UTC clock time) — a value that no longer round-trips back to
// the same calendar date consistently.
//
// This silently broke /api/poll's change-detection: a date fetched via one
// code path could come back as "2028-02-17T00:00:00.000Z" (parsed fresh
// from a bare date string, which IS UTC-midnight — correct) while the
// identical calendar date fetched via another path (a live DB read
// returning a Date object) came back as "2028-02-17T05:00:00.000Z" — two
// different instants for the same day, five hours apart. The poll's
// `.getTime()` comparison saw that as a genuine release-date change and
// fired a fresh notification for it, EVERY DAY, for every followed title
// that took this path — confirmed live for The Batman: Part II, Dune: Part
// Three, and Sonic the Hedgehog 4, each flip-flopping by a day on
// consecutive polls with no real date change behind it.
//
// Extracting the LOCAL calendar fields directly (getFullYear/getMonth/
// getDate) instead of going through toISOString() sidesteps the whole
// problem: the Date object was already constructed at local midnight FOR
// that calendar day, so reading its local fields recovers the day the
// driver actually meant, with no UTC round-trip to introduce an offset.
export function toISODate(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  if (!(value instanceof Date)) return value;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
