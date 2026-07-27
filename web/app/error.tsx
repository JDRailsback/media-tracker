"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

// Next's file-convention error boundary — catches any uncaught render
// error below the root layout. Must be a Client Component (Next's own
// requirement: it needs interactivity for the retry button and an effect
// to log the error). Without this file, an uncaught error fell through to
// Next's default unstyled error screen.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface">
        <AlertTriangle size={24} className="text-subtle" />
      </div>
      <h1 className="text-[20px] font-bold text-ink">Something went wrong</h1>
      <p className="mt-1.5 max-w-xs text-[14px] text-subtle">
        An unexpected error occurred. You can try again, or head back to the home page.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-full border border-hairline px-5 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-surface"
        >
          Back to Home
        </a>
      </div>
    </div>
  );
}
