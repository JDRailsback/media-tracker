import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, ensureSchema } from "@/lib/db";
import { claimLegacyDataIfFirstUser } from "@/lib/claimLegacyData";
import { isValidUsername, usernameTaken } from "@/lib/username";

// POST /api/auth/signup  { email, password, username } -> { ok: true }
// The one thing Auth.js's Credentials provider deliberately doesn't do for
// you: create the account. This just creates the users row (hashed
// password, a fresh calendar_token — see app/api/calendar/feed.ics); the
// client still calls next-auth's own signIn("credentials", ...) afterward
// to actually establish a session, same as any other login.
export const dynamic = "force-dynamic";

interface SignupBody {
  email?: unknown;
  password?: unknown;
  username?: unknown;
}

export async function POST(request: Request) {
  const { email: rawEmail, password, username: rawUsername }: SignupBody = await request.json();
  const email = String(rawEmail ?? "")
    .trim()
    .toLowerCase();
  const username = String(rawUsername ?? "").trim();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!isValidUsername(username)) {
    return NextResponse.json(
      { error: "Username must be 3-20 characters: letters, numbers, and underscores." },
      { status: 400 }
    );
  }

  await ensureSchema();
  const sql = db();

  const existing = (await sql`SELECT id FROM users WHERE email = ${email}`) as unknown as { id: number }[];
  if (existing.length > 0) {
    // Deliberately vague — confirming "that email doesn't exist" to an
    // anonymous caller is a user-enumeration leak for essentially no
    // benefit to a real signup flow.
    return NextResponse.json({ error: "Couldn't create that account. Try signing in instead." }, { status: 409 });
  }
  if (await usernameTaken(username)) {
    // Usernames are meant to be publicly checkable (unlike email), so
    // being specific here isn't the same enumeration risk as above.
    return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const rows = (await sql`
    INSERT INTO users (email, password_hash, calendar_token, username)
    VALUES (${email}, ${passwordHash}, ${randomUUID()}, ${username})
    RETURNING id
  `) as unknown as { id: number }[];

  await claimLegacyDataIfFirstUser(rows[0].id);

  return NextResponse.json({ ok: true });
}
