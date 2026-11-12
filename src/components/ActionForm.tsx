"use client";

import { useActionState } from "react";

export type ActionResult = { error?: string } | undefined;

/** A form whose server action reports refusals inline; `confirm` asks first for irreversible actions. */
export function ActionForm({
  action,
  confirm,
  className,
  children,
}: {
  action: (state: ActionResult, form: FormData) => Promise<ActionResult>;
  confirm?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, run] = useActionState(action, undefined);
  return (
    <form
      action={run}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state?.error && <p role="alert" className="mt-1 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
