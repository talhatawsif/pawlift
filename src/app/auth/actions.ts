"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDemoEnv, personaEmail, PERSONAS, type PersonaKey } from "@/lib/demo/personas";

export type FormState = { error?: string; notice?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email");
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      error:
        error.code === "email_not_confirmed"
          ? "Confirm your email first. Check your inbox for the link."
          : "That email and password don't match.",
    };
  }
  redirect("/");
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const displayName = str(form, "display_name");
  const email = str(form, "email");
  const password = String(form.get("password") ?? "");
  if (!displayName) return { error: "Enter your name." };
  if (!email) return { error: "Enter your email." };
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) {
    return { error: "We couldn't create that account. Try a different email or password." };
  }
  if (!data.session) {
    return { notice: "Check your email for a link to confirm your account, then sign in." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function switchPersona(form: FormData) {
  if (!isDemoEnv()) throw new Error("Not available");
  const key = str(form, "persona") as PersonaKey;
  if (!PERSONAS.some((p) => p.key === key)) throw new Error("Unknown persona");
  const password = process.env.DEMO_PASSWORD;
  const supabase = await createClient();
  await supabase.auth.signOut();
  if (!password) redirect("/?demo=missing-password");
  const { error } = await supabase.auth.signInWithPassword({
    email: personaEmail(key),
    password,
  });
  redirect(error ? "/?demo=not-seeded" : "/");
}
