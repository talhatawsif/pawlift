/** Static peek-state placeholder. Snap points and the nearby list arrive in Batch 3. */
export function BottomSheet() {
  return (
    <section
      aria-label="Animals needing a lift"
      className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-md rounded-t-2xl border border-b-0 border-border bg-surface px-4 pb-6 pt-3 shadow-md"
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden />
      <h2 className="text-base font-semibold">Animals needing a lift</h2>
      <p className="text-sm text-muted">
        Showing Western Melbourne. Nearby animals will appear here.
      </p>
    </section>
  );
}
