import { Users } from "lucide-react";
import { switchPersona } from "@/app/auth/actions";
import { PERSONAS, isDemoEnv } from "@/lib/demo/personas";

/** Demo persona switcher. Renders nothing unless APP_ENV=demo (checked again in the action). */
export function DemoSwitcher({ notice }: { currentUserId?: string; notice?: string }) {
  if (!isDemoEnv()) return null;
  return (
    <details className="relative">
      <summary
        aria-label="Switch demo persona"
        className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-full border border-border bg-background px-3 text-sm font-medium"
      >
        <Users size={16} aria-hidden /> DEMO
      </summary>
      <div className="absolute right-0 top-11 z-30 w-72 rounded-xl border border-border bg-surface p-3 text-sm shadow-md">
        <p className="mb-2 text-muted">Demo personas. Not real people or checks.</p>
        {notice === "not-seeded" && (
          <p role="alert" className="mb-2 text-danger">
            That demo account doesn&apos;t exist yet. Demo data is seeded in a later step.
          </p>
        )}
        {notice === "missing-password" && (
          <p role="alert" className="mb-2 text-danger">DEMO_PASSWORD isn&apos;t set.</p>
        )}
        <ul>
          {PERSONAS.map((p) => (
            <li key={p.key}>
              <form action={switchPersona}>
                <input type="hidden" name="persona" value={p.key} />
                <button type="submit" className="w-full rounded-lg px-2 py-2 text-left hover:bg-background">
                  <span className="block font-medium">{p.name}</span>
                  <span className="block text-muted">{p.role}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
