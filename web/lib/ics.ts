// Minimal RFC 5545 (iCalendar) writer — just enough for a flat list of
// all-day VEVENTs, which is all a release date ever needs (release dates
// are day-precision everywhere in this app, never a specific time). No
// library needed for something this small, and it keeps the feed dependency-
// free.

// Line folding: a physical line over 75 octets must be split, each
// continuation line starting with a single space (RFC 5545 §3.1). Measured
// in UTF-8 BYTES, not JS string length — a title with non-ASCII characters
// (é, —, …) takes more than one byte per character.
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    // Never split a multi-byte UTF-8 sequence in half — back off until end
    // sits on a byte that isn't a continuation byte (10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(bytes.subarray(offset, end).toString("utf8"));
    offset = end;
    limit = 74; // continuation lines lose one octet to their leading space
  }
  return chunks.join("\r\n ");
}

// Escapes text-value special characters per RFC 5545 §3.3.11 — backslash,
// semicolon, comma, and newline (literal \n, not a real line break, which
// would corrupt the file's own line structure).
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

function icsLine(name: string, value: string): string {
  return foldLine(`${name}:${escapeText(value)}`);
}

// UTC timestamp for DTSTAMP — required on every VEVENT, meaning "when this
// entry was generated," not a real event property; always "now" is correct.
function nowStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export interface ICSEvent {
  uid: string;
  date: string; // ISO YYYY-MM-DD
  summary: string;
  description?: string;
  url?: string;
}

function buildEvent(event: ICSEvent): string {
  const dateStamp = event.date.replace(/-/g, "");
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${nowStamp()}`,
    // VALUE=DATE (no time component) marks this as an all-day event —
    // calendar apps show it on the date itself, not at a specific hour.
    foldLine(`DTSTART;VALUE=DATE:${dateStamp}`),
    icsLine("SUMMARY", event.summary),
    event.description ? icsLine("DESCRIPTION", event.description) : null,
    event.url ? icsLine("URL", event.url) : null,
    "END:VEVENT",
  ].filter((l): l is string => l !== null);
  return lines.join("\r\n");
}

export function buildCalendar(events: ICSEvent[], calendarName: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Trackr//Release Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    icsLine("X-WR-CALNAME", calendarName),
    icsLine("X-WR-CALDESC", "Releases for everything you follow on Trackr"),
    ...events.map(buildEvent),
    "END:VCALENDAR",
  ];
  // CRLF line endings are mandatory per spec — several calendar clients
  // (notably older Outlook/Exchange) reject a feed that uses bare \n.
  return lines.join("\r\n") + "\r\n";
}
