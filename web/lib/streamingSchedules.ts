// Known, fixed global streaming-drop times, applied when TVmaze has no
// confirmed per-episode broadcast time on record. This is deliberately
// narrow — NOT a general "streaming = midnight PT" assumption applied to
// every platform. Apple TV+ is listed because its release time is a real,
// publicly documented, unvarying fact: every Apple TV+ original drops new
// episodes at exactly 12:00 AM Pacific / 3:00 AM Eastern on its release
// day, worldwide, with no regional variation — confirmed against
// press coverage of specific releases (e.g. Deadline's and Primetimer's
// Silo season 3 schedule reporting, both independently stating "12am PT /
// 3am ET" for every episode). This is treated as EXACT, not an estimate —
// the platform doesn't vary this, so there is no real fuzziness to hedge.
// Extending this list to another platform should meet the same bar: a
// confirmed, unvarying, publicly documented release time — not "probably
// midnight somewhere."
const STREAMING_DROP_TIMES: Record<string, { hour: number; timeZone: string }> = {
  "Apple TV": { hour: 0, timeZone: "America/Los_Angeles" },
};

// Standard technique for a timezone's UTC offset at a given instant, using
// only Intl (no dependency, and correct across DST transitions since the
// ICU tz database handles those rules, not a hardcoded PST/PDT switch that
// would silently go stale). Interprets `date` in `timeZone`, re-reads the
// resulting wall-clock fields AS IF they were UTC, and diffs against the
// real instant — the delta is the zone's offset in minutes at that moment.
function tzOffsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUTC - date.getTime()) / 60_000;
}

// dateISO: a day-precision "YYYY-MM-DD" — the release day (see
// lib/airtimes.ts for which source's date is used as the anchor). Returns
// the UTC instant of the platform's fixed drop time on that date, or
// undefined if none of the show's networks have a known one.
export function platformDropTimeUTC(networks: string[] | undefined, dateISO: string): string | undefined {
  const convention = networks?.map((n) => STREAMING_DROP_TIMES[n]).find((c) => c);
  if (!convention) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO);
  if (!m) return undefined;
  const [, y, mo, d] = m.map(Number) as unknown as [never, number, number, number];
  // Offset lookup uses UTC noon on the target date as the reference instant
  // — for every zone this heuristic realistically covers, that reference
  // falls on the same local calendar day as the target date, so it reads
  // the correct side of any DST boundary (which only ever flips near 2 AM
  // local, never near local noon).
  const offset = tzOffsetMinutes(convention.timeZone, new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)));
  return new Date(Date.UTC(y, mo - 1, d, convention.hour, 0, 0) - offset * 60_000).toISOString();
}
