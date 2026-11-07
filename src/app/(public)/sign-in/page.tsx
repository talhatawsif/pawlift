import { AuthForm } from "@/components/AuthForm";
import { signIn } from "@/app/auth/actions";

export const metadata = { title: "Sign in · PawLift" };

export default function SignInPage() {
  return <AuthForm mode="sign-in" action={signIn} />;
}
