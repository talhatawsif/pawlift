"use client";

import { useRef } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { trapTab } from "@/components/trapTab";

type Org = { id: string; name: string };

const pill =
  "absolute left-4 z-10 flex h-12 items-center gap-2 rounded-full bg-surface px-5 font-semibold text-brand shadow-[var(--shadow-soft)] ring-1 ring-border";

/** Map button for active coordinators: straight to the new-request form, or a choice of organisation first. */
export function AddLift({ orgs, bottom }: { orgs: Org[]; bottom: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const style = { bottom, transition: "bottom 150ms ease-out" };
  const href = (o: Org) => `/org/${o.id}/requests/new`;

  if (orgs.length === 1) {
    return (
      <Link href={href(orgs[0])} style={style} className={pill}>
        <Plus size={18} aria-hidden /> Add lift
      </Link>
    );
  }
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => ref.current?.showModal()} style={style} className={pill}>
        <Plus size={18} aria-hidden /> Add lift
      </button>
      <dialog
        ref={ref}
        aria-label="Which organisation?"
        onKeyDown={trapTab}
        onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
        className="m-auto w-80 max-w-[85vw] rounded-2xl bg-surface p-0 text-foreground shadow-md backdrop:bg-black/40"
      >
        <div className="p-4" onClick={(e) => (e.target as HTMLElement).closest("a") && ref.current?.close()}>
          <p className="mb-2 font-semibold">Which organisation is this lift for?</p>
          <ul>
            {orgs.map((o) => (
              <li key={o.id}>
                <Link href={href(o)} className="flex h-12 items-center rounded-lg px-3 hover:bg-background">
                  {o.name}
                </Link>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => ref.current?.close()} className="mt-2 w-full btn-text !text-muted">
            Cancel
          </button>
        </div>
      </dialog>
    </>
  );
}
