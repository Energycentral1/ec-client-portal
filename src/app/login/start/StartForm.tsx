"use client";
import { useActionState } from "react";
import { startLogin } from "../actions";

export function StartForm({ tokenHash, type }: { tokenHash: string; type: "invite" | "recovery" }) {
  const [state, action, pending] = useActionState(startLogin, null);
  if (!tokenHash) return <p className="mt-4 text-sm text-ink/70">This link is incomplete. Ask your Energy Central contact for a new one.</p>;
  return (
    <form action={action}>
      <input type="hidden" name="token_hash" value={tokenHash} /><input type="hidden" name="type" value={type} />
      <p className="mt-2 text-sm text-ink/70">{type === "invite" ? "Your login is ready. Next you'll choose a password." : "Next you'll choose a new password."}</p>
      {state?.error && <p role="alert" className="mt-4 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="mt-6 w-full rounded-lg bg-navy px-4 py-3 font-semibold text-white hover:bg-navy-dark disabled:opacity-60">
        {pending ? "One moment…" : "Choose a password"}</button>
    </form>
  );
}
