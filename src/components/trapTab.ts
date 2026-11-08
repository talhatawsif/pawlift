import type { KeyboardEvent } from "react";

/** Wrap Tab/Shift+Tab inside a modal <dialog>: browsers otherwise let focus escape to their own chrome. */
export function trapTab(e: KeyboardEvent<HTMLDialogElement>) {
  if (e.key !== "Tab") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("a[href], button, summary, input, select")].filter(
    (el) => el.offsetParent !== null,
  );
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
