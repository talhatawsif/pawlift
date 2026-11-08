import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { NavMenu } from "@/components/NavMenu";

// Menu only; authorisation stays in each page.
export default function OrgLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
        <Suspense fallback={<div className="h-10 w-10" aria-hidden />}>
          <NavMenu />
        </Suspense>
        <Link href="/" className="text-sm font-semibold">PawLift</Link>
      </header>
      {children}
    </>
  );
}
