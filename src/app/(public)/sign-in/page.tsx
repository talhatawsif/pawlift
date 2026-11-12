import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { signIn } from "@/app/auth/actions";
import { safeNext } from "@/lib/session";

export const metadata = { title: "Sign in · PawLift" };

async function SignInContent({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-in" action={signIn} next={safeNext(next)} />;
}

export default function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <SignInContent searchParams={searchParams} />
    </Suspense>
  );
}
