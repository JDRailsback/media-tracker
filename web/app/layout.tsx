import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Media Tracker",
  description: "Track releases across movies, games, and manga.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#111111",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
