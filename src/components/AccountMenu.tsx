import Link from "next/link";
import { connection } from "next/server";
import { LogOut, User } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { getMyContext, roleLabels } from "@/lib/session";
import { DemoSwitcher } from "@/components/DemoSwitcher";
import { isDemoEnv } from "@/lib/demo/personas";

/** Account control for the shell: sign-in link when signed out, role-aware menu when signed in. */
export async function AccountMenu({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  await connection();
  const { demo: demoNotice } = await searchParams;
  const ctx = await getMyContext();
  const demo = isDemoEnv();

  return (
    <div className="flex items-center gap-2">
      {demo && <DemoSwitcher currentUserId={ctx?.user_id} notice={demoNotice} />}
      {!ctx ? (
        <Link
          href="/sign-in"
          className="flex h-9 items-center rounded-full border border-border px-3 text-sm font-medium"
        >
          Sign in
        </Link>
      ) : (
        <details className="relative">
          <summary
            aria-label="Account menu"
            className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-border bg-background"
          >
            <User size={18} aria-hidden />
          </summary>
          <div className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-border bg-surface p-3 text-sm shadow-md">
            <p className="font-semibold">{ctx.display_name ?? "Your account"}</p>
            {ctx.account_status === "suspended" && (
              <p className="mt-1 text-danger">Your account is suspended.</p>
            )}
            <ul className="mt-1 text-muted">
              {roleLabels(ctx).map((l) => (
                <li key={l}>{l}</li>
              ))}
              {roleLabels(ctx).length === 0 && <li>Member</li>}
            </ul>
            <ul className="mt-2 border-t border-border pt-2">
              {ctx.memberships
                .filter((m) => m.status === "active" && m.is_coordinator)
                .map((m) => (
                  <li key={m.org_id}>
                    <Link href={`/org/${m.org_id}`} className="flex h-10 items-center font-medium">
                      {m.org_name}
                    </Link>
                    <Link href={`/org/${m.org_id}/dashboard`} className="flex h-10 items-center pl-3 text-muted">
                      Dashboard
                    </Link>
                  </li>
                ))}
              <li>
                <Link href="/assignments" className="flex h-10 items-center font-medium">
                  My assignments
                </Link>
              </li>
              <li>
                <Link href="/volunteer" className="flex h-10 items-center font-medium">
                  Volunteer profile
                </Link>
              </li>
              {ctx.memberships.some((m) => m.status === "active" && m.is_foster_carer) && (
                <li>
                  <Link href="/foster" className="flex h-10 items-center font-medium">
                    My foster home
                  </Link>
                </li>
              )}
              <li>
                <Link href="/join" className="flex h-10 items-center font-medium">
                  Find an organisation
                </Link>
              </li>
              <li>
                <Link href="/org/new" className="flex h-10 items-center font-medium">
                  Register an organisation
                </Link>
              </li>
              {ctx.is_admin && (
                <li>
                  <Link href="/admin/organisations" className="flex h-10 items-center font-medium">
                    Verify organisations
                  </Link>
                </li>
              )}
              {ctx.is_admin && (
                <li>
                  <Link href="/admin/volunteers" className="flex h-10 items-center font-medium">
                    Verify volunteers
                  </Link>
                </li>
              )}
            </ul>
            <form action={signOut} className="mt-3 border-t border-border pt-3">
              <button type="submit" className="flex h-10 w-full items-center gap-2 text-left font-medium">
                <LogOut size={16} aria-hidden /> Sign out
              </button>
            </form>
          </div>
        </details>
      )}
    </div>
  );
}
