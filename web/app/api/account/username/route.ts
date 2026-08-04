import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { auth } from "@/auth";
import { isValidUsername } from "@/lib/username";

// POST /api/account/username  { username } -> { ok: true, username }
// Session-only. Lets someone who signed up before this existed (or via
// Google, which only ever auto-generated one) pick something they actually
// chose. The client follows a successful response with useSession()'s
// update({ username }) to refresh the session cookie immediately — see
// auth.ts's jwt callback.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (userId === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { username: rawUsername } = await request.json();
  const username = String(rawUsername ?? "").trim();
  if (!isValidUsername(username)) {
    return NextResponse.json(
      { error: "Username must be 3-20 characters: letters, numbers, and underscores." },
      { status: 400 }
    );
  }

  await ensureSchema();
  const sql = db();
  // Case-insensitive, and excludes the caller's own row — resubmitting your
  // current username in a different case (or unchanged) must not read as
  // "taken" (see lib/db.ts's users_username_lower_idx).
  const existing = (await sql`
    SELECT id FROM users WHERE LOWER(username) = LOWER(${username}) AND id != ${userId}
  `) as unknown as { id: number }[];
  if (existing.length > 0) {
    return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
  }

  await sql`UPDATE users SET username = ${username} WHERE id = ${userId}`;
  return NextResponse.json({ ok: true, username });
}
