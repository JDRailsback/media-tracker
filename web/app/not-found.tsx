import Link from "next/link";
import { Compass } from "lucide-react";

// Next's file-convention 404 — renders for any unmatched route. The known
// dynamic routes (collection/[slug], artist/[id]) already handle a bad id
// gracefully with their own in-app "Unknown collection/artist" message;
// this only ever fires for a genuinely mistyped/nonexistent path, so it
// just needs to look like the rest of the app rather than Next's default.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface">
        <Compass size={26} className="text-subtle" />
      </div>
      <h1 className="text-[20px] font-bold text-ink">Page not found</h1>
      <p className="mt-1.5 max-w-xs text-[14px] text-subtle">
        There&rsquo;s nothing here. The page may have moved or the link might be wrong.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent transition-opacity hover:opacity-90"
      >
        Back to Home
      </Link>
    </div>
  );
}
