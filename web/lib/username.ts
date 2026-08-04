import { db } from "@/lib/db";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

// Case-insensitive on purpose — "Foo" and "foo" reading as two different
// available usernames is exactly the confusing-near-duplicate problem this
// guards against (see lib/db.ts's users_username_lower_idx, the actual
// DB-level guarantee this check mirrors).
export async function usernameTaken(username: string): Promise<boolean> {
  const sql = db();
  const rows = await sql`SELECT 1 FROM users WHERE LOWER(username) = LOWER(${username})`;
  return rows.length > 0;
}

// Google sign-in has no native username concept — this best-effort default
// derives one from the Google display name (or email local-part) so a new
// Google account isn't left with no username at all. Falls back to
// appending a number when the sanitized base is already taken.
export async function deriveUniqueUsername(seed: string): Promise<string> {
  const base = (seed.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20) || "user").padEnd(3, "0");
  let candidate = base;
  let n = 1;
  while (await usernameTaken(candidate)) {
    n += 1;
    candidate = `${base}${n}`.slice(0, 20);
  }
  return candidate;
}
