// Decorative, fixed ambient glow behind the app content. Purely visual —
// aria-hidden and non-interactive.
export default function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-gradient-to-br from-accent/25 via-accent-2/10 to-transparent blur-3xl" />
      <div className="absolute -right-32 top-1/3 h-[26rem] w-[26rem] rounded-full bg-gradient-to-bl from-accent-2/20 via-accent/10 to-transparent blur-3xl" />
      <div className="absolute bottom-[-10rem] left-1/3 h-[28rem] w-[28rem] rounded-full bg-gradient-to-tr from-accent/15 to-transparent blur-3xl" />
    </div>
  );
}
