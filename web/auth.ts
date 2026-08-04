import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, ensureSchema } from "@/lib/db";
import { claimLegacyDataIfFirstUser } from "@/lib/claimLegacyData";
import { deriveUniqueUsername } from "@/lib/username";

// Auth.js's default Session/JWT types don't carry our own numeric users.id
// (only name/email/image) — this is the documented way to extend them
// rather than reaching for `as any` at every call site that needs it.
declare module "next-auth" {
  interface Session {
    user: { id: string; calendarToken: string; username: string; isAdmin: boolean } & DefaultSession["user"];
  }
  interface User {
    calendarToken?: string;
    username?: string;
  }
}
// next-auth/jwt's JWT type lives behind a re-export chain that this
// project's "bundler" moduleResolution can't target with a `declare module`
// augmentation (a beta-library resolution quirk, not a real typing gap) —
// worked around below with one contained assertion at the two call sites
// instead of fighting it.

interface UserRow {
  id: number;
  email: string;
  password_hash: string | null;
  name: string | null;
  image: string | null;
  calendar_token: string;
  username: string | null;
}

// JWT session strategy, not database sessions — Credentials providers
// require it (Auth.js has no way to persist a Credentials-derived session
// server-side without one), and it means no sessions/accounts adapter
// tables: session state lives entirely in the signed session cookie, and
// user identity resolution below just queries the existing `users` table
// directly through lib/db.ts's own sql helper — no Adapter interface, no
// ORM, nothing new to learn beyond what the rest of this app already uses.
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        await ensureSchema();
        const sql = db();
        const rows = (await sql`
          SELECT id, email, password_hash, name, image, calendar_token, username FROM users WHERE email = ${email}
        `) as unknown as UserRow[];
        const user = rows[0];
        // No password_hash means this email only ever signed up via Google
        // — there's nothing here to compare against, so this must fail
        // rather than silently letting an empty hash "match."
        if (!user || !user.password_hash) return null;
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        return {
          id: String(user.id),
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          calendarToken: user.calendar_token,
          username: user.username ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    // Credentials logins already resolved a real users.id in authorize()
    // above — this only does work for Google, which only ever proves an
    // email address and needs matching against (or creating) our own
    // users row before a session can carry our id.
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      if (!user.email) return false;

      await ensureSchema();
      const sql = db();
      const existing = (await sql`
        SELECT id, calendar_token, username FROM users WHERE email = ${user.email}
      `) as unknown as { id: number; calendar_token: string; username: string | null }[];

      let userId: number;
      let calendarToken: string;
      let username: string | null;
      if (existing.length > 0) {
        userId = existing[0].id;
        calendarToken = existing[0].calendar_token;
        username = existing[0].username;
        await sql`UPDATE users SET name = ${user.name ?? null}, image = ${user.image ?? null} WHERE id = ${userId}`;
      } else {
        calendarToken = randomUUID();
        // Google has no native username concept — best-effort default from
        // the display name/email (see lib/username.ts), not a required step.
        username = await deriveUniqueUsername(user.name || user.email.split("@")[0]);
        const rows = (await sql`
          INSERT INTO users (email, name, image, calendar_token, username)
          VALUES (${user.email}, ${user.name ?? null}, ${user.image ?? null}, ${calendarToken}, ${username})
          RETURNING id
        `) as unknown as { id: number }[];
        userId = rows[0].id;
        await claimLegacyDataIfFirstUser(userId);
      }
      user.id = String(userId);
      user.calendarToken = calendarToken;
      user.username = username ?? undefined;
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user?.id) {
        (token as { userId?: string }).userId = user.id;
        (token as { calendarToken?: string }).calendarToken = user.calendarToken;
        (token as { username?: string }).username = user.username;
      }
      // Lets the client refresh the session cookie right after changing
      // username (see app/api/account/username) without forcing a
      // sign-out/sign-in — the client calls useSession()'s update({
      // username }), which re-runs this callback with trigger: "update".
      if (trigger === "update" && typeof (session as { username?: unknown })?.username === "string") {
        (token as { username?: string }).username = (session as { username: string }).username;
      }
      return token;
    },
    async session({ session, token }) {
      const userId = (token as { userId?: string }).userId;
      const calendarToken = (token as { calendarToken?: string }).calendarToken;
      const username = (token as { username?: string }).username;
      if (userId) session.user.id = userId;
      if (calendarToken) session.user.calendarToken = calendarToken;
      // Falls back to an email-derived name for the one real account that
      // predates this column (see lib/db.ts's schema comment) rather than
      // ever showing a blank identity.
      session.user.username = username ?? session.user.email?.split("@")[0] ?? "there";
      // Read fresh from the DB every time rather than trusting a value
      // baked into the JWT at sign-in — is_admin can change after a
      // session's token was already minted (exactly what happened here:
      // this account signed in before is_admin existed, so it was
      // permanently stuck reading as false no matter what the DB said).
      // Fails closed (never admin) on any error or missing row.
      session.user.isAdmin = false;
      if (userId) {
        try {
          const sql = db();
          const rows = (await sql`SELECT is_admin FROM users WHERE id = ${Number(userId)}`) as unknown as {
            is_admin: boolean;
          }[];
          session.user.isAdmin = rows[0]?.is_admin ?? false;
        } catch {
          session.user.isAdmin = false;
        }
      }
      return session;
    },
  },
});
