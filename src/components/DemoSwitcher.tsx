import { Users } from "lucide-react";
import { switchPersona } from "@/app/auth/actions";
import { PERSONAS, isDemoEnv } from "@/lib/demo/personas";

/** Demo persona switcher. Renders nothing unless APP_ENV=demo (checked again in the action). */
export function DemoSwitcher({ notice }: { currentUserId?: string; notice?: string }) {
  if (!isDemoEnv()) return null;
  return (
    <details className="mt-3 border-t border-border pt-2" open={notice != null}>
      <summary
        className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-background"
      >
        <Users size={16} aria-hidden /> DEMO personas
      </summary>
      <div className="px-3 text-sm">
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
