// ── Route loading ────────────────────────────────────────────────────────────
// Shown while a route's own JS and data are still arriving. It is deliberately
// the same mark the chat shows while it thinks, so the app never appears to
// hand off to a different screen between pages.

export default function Loading() {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-[#060a08]">
      <span
        className="h-7 w-7 animate-spin rounded-full border-2 border-[#a9d8bb]/40 border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
