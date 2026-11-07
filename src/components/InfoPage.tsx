import Link from "next/link";

export const INFO_LINKS = [
  { href: "/about", label: "About" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/transport-safety", label: "Transport safety" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

export function InfoPage({
  title,
  intro,
  draft,
  children,
}: {
  title: string;
  intro?: string;
  draft?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link href="/" className="inline-flex h-10 items-center text-sm font-medium text-brand underline">
        Back to the map
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      {intro && <p className="mt-2 text-muted">{intro}</p>}
      {draft && (
        <p role="note" className="mt-4 rounded-lg border border-urgent bg-surface p-3 text-sm">
          <strong className="font-semibold text-urgent">DRAFT.</strong> This text has not been reviewed by a lawyer or
          other professional and must be before PawLift is used outside the demo. It is not legal advice.
        </p>
      )}
      <div className="mt-6 space-y-6 leading-relaxed">{children}</div>
      <nav aria-label="About PawLift" className="mt-10 border-t border-border pt-4">
        <ul className="flex flex-wrap gap-x-4 text-sm">
          {INFO_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex h-10 items-center text-muted underline">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}
