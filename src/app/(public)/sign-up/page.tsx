import { AuthForm } from "@/components/AuthForm";
import { signUp } from "@/app/auth/actions";

export const metadata = { title: "Create account · PawLift" };

export default function SignUpPage() {
  return <AuthForm mode="sign-up" action={signUp} />;
}
