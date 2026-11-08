"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { trapTab } from "@/components/trapTab";

export type NavItem = { label: string; href: string; exact?: boolean; badge?: number };
export type NavSection = { title?: string; titleHref?: string; items: NavItem[] };

type Props = {
  sections: NavSection[];
  heading?: ReactNode;
  footer?: ReactNode;
  signOut?: () => Promise<void>;
  unread?: number;
  autoOpen?: boolean;
};

/** Menu button plus a left drawer. A native modal <dialog> gives the focus trap, Escape and focus return. */
export function NavDrawer({ sections, heading, footer, signOut, unread = 0, autoOpen = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(autoOpen);
  const pathname = usePathname();

  const show = () => {
    ref.current?.showModal();
    setOpen(true);
  };
  useEffect(() => {
    if (autoOpen) ref.current?.showModal();
  }, [autoOpen]);

  const current = (i: NavItem) => pathname === i.href || (!i.exact && pathname.startsWith(`${i.href}/`));
  const row = "flex h-10 items-center rounded-lg px-3 text-sm";

  return (
    <>
      <button
        type="button"
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background"
      >
        <Menu size={18} aria-hidden />
        {unread > 0 && (
          <>
            <span aria-hidden className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-brand" />
            <span className="sr-only"> {unread} unread notifications</span>
          </>
        )}
      </button>
      <dialog
        ref={ref}
        aria-label="Menu"
        onClose={() => setOpen(false)}
        onKeyDown={trapTab}
        // A click on the backdrop lands on the dialog element itself; the padded wrapper below catches the rest.
        onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
        className="m-0 h-dvh max-h-dvh w-80 max-w-[85vw] overflow-y-auto bg-surface p-0 text-foreground shadow-md backdrop:bg-black/40"
      >
        <div className="flex min-h-full flex-col p-3" onClick={(e) => (e.target as HTMLElement).closest("a") && ref.current?.close()}>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="mb-2 self-end rounded-lg px-3 py-2 text-sm font-medium text-muted"
          >
            Close
          </button>
          {heading && <div className="mb-2 px-3 text-sm">{heading}</div>}
          <nav aria-label="Site" className="flex flex-col gap-3">
            {sections.map((s, n) => (
              <div key={n} className={n > 0 || heading ? "border-t border-border pt-2" : ""}>
                {s.title &&
                  (s.titleHref ? (
                    <Link
                      href={s.titleHref}
                      aria-current={pathname === s.titleHref ? "page" : undefined}
                      className={`${row} font-semibold ${pathname === s.titleHref ? "bg-brand/10" : ""}`}
                    >
                      {s.title}
                    </Link>
                  ) : (
                    <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{s.title}</p>
                  ))}
                <ul>
                  {s.items.map((i) => (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        aria-current={current(i) ? "page" : undefined}
                        className={`${row} ${current(i) ? "bg-brand/10 font-semibold" : "hover:bg-background"}`}
                      >
                        {i.label}
                        {i.badge ? (
                          <span className="ml-2 rounded-full bg-brand px-2 text-xs font-semibold text-brand-foreground">
                            {i.badge > 99 ? "99+" : i.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          {footer}
          {signOut && (
            <form action={signOut} className="mt-auto border-t border-border pt-2">
              <button type="submit" className={`${row} w-full gap-2 text-left font-medium hover:bg-background`}>
                <LogOut size={16} aria-hidden /> Sign out
              </button>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
