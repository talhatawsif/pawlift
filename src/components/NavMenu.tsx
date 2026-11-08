import { connection } from "next/server";
import { signOut } from "@/app/auth/actions";
import { getMyContext, roleLabels } from "@/lib/session";
import { DemoSwitcher } from "@/components/DemoSwitcher";
import { NavDrawer, type NavSection } from "@/components/NavDrawer";
import { isDemoEnv } from "@/lib/demo/personas";
import { createClient } from "@/lib/supabase/server";

const ORG_PAGES = [
  ["Dashboard", "dashboard"],
  ["Requests", "requests"],
  ["Locations", "locations"],
  ["Members", "members"],
  ["History", "history"],
  ["Audit trail", "audit"],
  ["Settings", "settings"],
] as const;

const ADMIN_PAGES = [
  ["Admin dashboard", "/admin", true],
  ["All requests", "/admin/requests"],
  ["Verify organisations", "/admin/organisations"],
  ["Verify volunteers", "/admin/volunteers"],
  ["Incidents", "/admin/incidents"],
  ["Audit log", "/admin/audit"],
  ["Private access log", "/admin/private-access"],
] as const;

/** The menu drawer. It only shows or hides links: every page and RPC re-checks access itself. */
export async function NavMenu({ demoNotice }: { demoNotice?: string }) {
  await connection();
  const ctx = await getMyContext();
  const demo = isDemoEnv();
  const footer = demo ? <DemoSwitcher currentUserId={ctx?.user_id} notice={demoNotice} /> : null;
  const autoOpen = demo && demoNotice != null; // show a failed persona switch

  if (!ctx) {
    return (
      <NavDrawer
        autoOpen={autoOpen}
        footer={footer}
        sections={[{ items: [{ label: "About PawLift", href: "/about" }, { label: "Sign in", href: "/sign-in" }] }]}
      />
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("count_my_unread_notifications");
  const unread = typeof data === "number" ? data : 0;
  const orgs = ctx.memberships.filter((m) => m.status === "active" && m.is_coordinator);

  const sections: NavSection[] = orgs.map((m) => ({
    title: m.org_name,
    titleHref: `/org/${m.org_id}`,
    items: ORG_PAGES.map(([label, path]) => ({ label, href: `/org/${m.org_id}/${path}` })),
  }));
  const me: NavSection = {
    items: [
      { label: "Notifications", href: "/notifications", badge: unread },
      { label: "My assignments", href: "/assignments" },
      { label: "Volunteer profile", href: "/volunteer" },
      ...(ctx.memberships.some((m) => m.status === "active" && m.is_foster_carer)
        ? [{ label: "My foster home", href: "/foster" }]
        : []),
      { label: "Find an organisation", href: "/join" },
      { label: "Register an organisation", href: "/org/new" },
      { label: "About PawLift", href: "/about" },
    ],
  };
  sections.push(me);
  if (ctx.is_admin) {
    sections.push({
      title: "Admin",
      items: ADMIN_PAGES.map(([label, href, exact]) => ({ label, href, exact: exact === true })),
    });
  }

  return (
    <NavDrawer
      sections={sections}
      unread={unread}
      autoOpen={autoOpen}
      footer={footer}
      signOut={signOut}
      heading={
        <>
          <p className="font-semibold">{ctx.display_name ?? "Your account"}</p>
          {ctx.account_status === "suspended" && <p className="text-danger">Your account is suspended.</p>}
          <ul className="text-muted">
            {roleLabels(ctx).map((l) => (
              <li key={l}>{l}</li>
            ))}
            {roleLabels(ctx).length === 0 && <li>Member</li>}
          </ul>
        </>
      }
    />
  );
}
