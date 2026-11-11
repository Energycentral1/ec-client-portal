"use client";
import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={action} className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-navy">Energy Central</p>
        <h1 className="mt-1 text-2xl font-semibold">Partner Portal</h1>
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
    </main>
  );
}
