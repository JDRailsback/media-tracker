"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowLeft } from "lucide-react";

// Plain route (like /calendar), not part of the SPA's view switch — signing
// in is a one-off flow, not a tab you revisit. Email/password is handled
// directly here; Google goes through next-auth/react's redirect flow.
export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, username }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "Could not create account");
          setBusy(false);
          return;
        }
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("Invalid email or password");
        setBusy(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong — try again");
      setBusy(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link
        href="/"
        className="absolute left-6 top-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-subtle transition-colors hover:text-ink md:left-12"
      >
        <ArrowLeft size={14} />
        Back
      </Link>

      <h1 className="text-[28px] font-bold tracking-tight text-ink">
        {mode === "signin" ? "Sign in" : "Create account"}
      </h1>
      <p className="mt-1 text-[14px] text-subtle">
        {mode === "signin"
          ? "Sync your follows and Dugout across every browser."
          : "One account, all your devices in sync."}
      </p>

      <button
        onClick={() => signIn("google", { callbackUrl: "/" })}
        className="mt-6 flex items-center justify-center gap-2 rounded-full bg-surface px-4 py-2.5 text-[14px] font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-panel"
      >
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-[12px] text-subtle">
        <div className="h-px flex-1 bg-hairline" />
        or
        <div className="h-px flex-1 bg-hairline" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
        />
        {mode === "signup" && (
          <input
            type="text"
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]+"
            title="Letters, numbers, and underscores only"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input"
          />
        )}
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
        />
        {error && <p className="text-[13px] text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-full bg-accent px-4 py-2.5 text-[14px] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
        className="mt-4 text-[13px] font-medium text-subtle transition-colors hover:text-ink"
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </main>
  );
}
