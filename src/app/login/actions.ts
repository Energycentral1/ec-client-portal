"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signIn(_prev: { error: string } | null, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { error: "That email and password don't match. Try again, or ask your Energy Central contact for a new password." };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Change your own password while signed in. */
export async function setPassword(_prev: { error: string } | null, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  if (password !== String(formData.get("again") ?? "")) return { error: "The two passwords don't match." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/");
}
