"use client";
import { useActionState } from "react";
import { signIn } from "./actions";
import { LoginFrame } from "@/components/LoginFrame";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <LoginFrame>
      <form action={action}>
        <p className="mt-2 text-sm text-ink/70">Sign in to see your campaign results and leads.</p>
        <label htmlFor="email" className="mt-6 block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 outline-none focus:border-sky focus:ring-2 focus:ring-sky/30" />
        <label htmlFor="password" className="mt-4 block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 outline-none focus:border-sky focus:ring-2 focus:ring-sky/30" />
        {state?.error && <p role="alert" className="mt-4 text-sm text-red-700">{state.error}</p>}
        <button type="submit" disabled={pending}
          className="mt-6 w-full rounded-lg bg-navy px-4 py-3 font-semibold text-white hover:bg-navy-dark disabled:opacity-60">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-5 text-sm text-ink/60">First time here, or forgot your password? Ask your Energy Central contact for a sign-in link.</p>
    </LoginFrame>
  );
}
