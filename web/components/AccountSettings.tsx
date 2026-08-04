"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

// Settings → "Account" block. Signed out: a link to /signin. Signed in:
// username + sign-out, plus editing the username itself — that's the whole
// surface area an account needs here, per the "simple, nothing too
// intricate" scope for this feature. The always-visible entry point lives
// in Sidebar's own account row instead of here — this is where sign-out
// and the username editor actually are.
export default function AccountSettings() {
  const { data: session, status, update } = useSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (status === "loading") {
    return <span className="text-[13px] text-subtle">Loading…</span>;
  }

  if (!session) {
    return (
      <Link
        href="/signin"
        className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent transition-opacity hover:opacity-90"
      >
        Sign in
      </Link>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/account/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not update username");
        setSaving(false);
        return;
      }
      // Refreshes the session cookie in place (JWT strategy — see auth.ts's
      // jwt callback) so Sidebar/AccountCorner show the new name immediately,
      // no sign-out/sign-in round trip needed.
      await update({ username: body.username });
      setEditing(false);
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-subtle">Signed in as @{session.user?.username}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="rounded-full bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink ring-1 ring-hairline transition-colors hover:bg-panel"
        >
          Sign out
        </button>
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]+"
            title="Letters, numbers, and underscores only"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New username"
            className="input w-44"
            autoFocus
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="rounded-full bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink ring-1 ring-hairline transition-colors hover:bg-panel"
          >
            Cancel
          </button>
          {error && <p className="w-full text-[12.5px] text-red-400">{error}</p>}
        </form>
      ) : (
        <button
          onClick={() => {
            setDraft(session.user?.username ?? "");
            setEditing(true);
          }}
          className="self-start text-[13px] font-medium text-subtle transition-colors hover:text-ink"
        >
          Change username
        </button>
      )}
    </div>
  );
}
