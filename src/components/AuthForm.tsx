"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/app/auth/actions";

type Props = {
  mode: "sign-in" | "sign-up";
  action: (state: FormState, form: FormData) => Promise<FormState>;
};

const input =
  "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";

export function AuthForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const signUp = mode === "sign-up";
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">
        {signUp ? "Create your account" : "Sign in"}
      </h1>
      <p className="mb-6 text-muted">
        {signUp
          ? "You're already going somewhere. You might be able to help an animal get there too."
          : "Welcome back to PawLift."}
      </p>
      <form action={formAction} className="flex flex-col gap-4">
        {signUp && (
          <div>
            <label htmlFor="display_name" className="mb-1 block text-sm font-medium">
              Your name
            </label>
            <input id="display_name" name="display_name" autoComplete="name" required className={input} />
          </div>
        )}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className={input} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={signUp ? "new-password" : "current-password"}
            minLength={signUp ? 8 : undefined}
            required
            className={input}
          />
        </div>
        {state?.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {state?.notice && (
          <p role="status" className="text-sm text-brand">
            {state.notice}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="h-12 btn-primary disabled:opacity-60"
        >
          {signUp ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {signUp ? "Already have an account? " : "New to PawLift? "}
        <Link href={signUp ? "/sign-in" : "/sign-up"} className="font-medium text-brand underline">
          {signUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </main>
  );
}
