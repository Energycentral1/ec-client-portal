"use server";
import { revalidatePath } from "next/cache";
import { createClient, getProfile } from "@/lib/supabase/server";

const MAX_BYTES = 4 * 1024 * 1024; // Vercel caps a request at about 4.5 MB; bigger creative goes in as a link.
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const isHttps = (u: string) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
const refresh = () => { revalidatePath("/admin", "layout"); revalidatePath("/portal"); };

export type ProofFormState = { error?: string; ok?: number; message?: string };

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ec-client-portal.vercel.app";

/** Emails the client's own logins that something is waiting for them. Only ever called when a team member adds creative
 *  with "Email the client" ticked. Returns a sentence saying exactly who was emailed, so nothing goes out silently. */
async function notifyClient(supabase: Awaited<ReturnType<typeof createClient>>, clientId: string, name: string): Promise<string> {
  const { data: logins } = await supabase.from("profiles").select("email").eq("client_id", clientId).eq("role", "client");
  const to = (logins ?? []).map((l) => l.email).filter(Boolean);
  if (to.length === 0) return "No one was emailed: this client has no logins yet.";
  const key = process.env.RESEND_API_KEY; const from = process.env.PORTAL_FROM_EMAIL;
  if (!key || !from) return `No one was emailed: email sending isn't set up yet (${to.length} login${to.length === 1 ? "" : "s"} would have been).`;
  const sent: string[] = [];
  for (const email of to) {
    const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: "New creative from Energy Central is ready for your approval",
        text: `Hi,\n\n"${name}" is ready for your review in the Energy Central partner portal.\n\nOpen it here: ${SITE}/portal#approvals\n\nYou can approve it there, or tell us what to change.\n\nEnergy Central` }) });
    if (res.ok) sent.push(email);
  }
  return sent.length ? `Emailed ${sent.join(", ")}.` : "The notification email failed to send.";
}

/** Energy Central adds a proof for a client to review. Nothing is emailed: the client sees it next time they open the portal. */
export async function addProof(_prev: ProofFormState, fd: FormData): Promise<ProofFormState> {
  const profile = await getProfile();
  if (profile?.role !== "admin") return { error: "Only the Energy Central team can add creative." };
  const clientId = text(fd, "client_id"); const name = text(fd, "name");
  const link = text(fd, "link_url"); const click = text(fd, "click_url"); const copy = text(fd, "copy_text");
  const deliverableId = text(fd, "deliverable_id");
  const file = fd.get("file") as File | null;
  const hasFile = !!file && file.size > 0;
  if (!clientId || !name) return { error: "Give it a name." };
  if (link && !isHttps(link)) return { error: "The link needs to start with https://" };
  if (click && !isHttps(click)) return { error: "The click-through URL needs to start with https://" };
  if (!hasFile && !link && !copy) return { error: "Add a file, a link or the ad copy." };
  if (hasFile && file!.size > MAX_BYTES) return { error: "That file is over 4 MB. Paste a link to it instead." };

  const supabase = await createClient();
  let due = text(fd, "due_date");
  if (!due && deliverableId) {
    const { data: d } = await supabase.from("deliverables").select("start_date").eq("id", deliverableId).single();
    if (d?.start_date) due = new Date(Date.parse(d.start_date + "T00:00:00Z") - 3 * 864e5).toISOString().slice(0, 10);
  }
  let path: string | null = null;
  if (hasFile) {
    path = `${clientId}/${crypto.randomUUID()}-${file!.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80)}`;
    const { error } = await supabase.storage.from("proofs").upload(path, file!, { contentType: file!.type || undefined });
    if (error) return { error: `Upload failed: ${error.message}` };
  }
  const { error } = await supabase.from("proofs").insert({ client_id: clientId, deliverable_id: deliverableId, name, copy_text: copy, click_url: click,
    note: text(fd, "note"), file_path: path, link_url: link, due_date: due });
  if (error) {
    if (path) await supabase.storage.from("proofs").remove([path]);
    return { error: error.message };
  }
  refresh();
  const message = fd.get("notify") === "on" ? await notifyClient(supabase, clientId, name) : "No one was emailed.";
  return { ok: Date.now(), message };
}

/** Client (or admin on their behalf) approves a proof or asks for changes; admins can also send one back to review. */
export async function reviewProof(fd: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_proof", { p_id: String(fd.get("id")), p_decision: String(fd.get("decision")), p_feedback: text(fd, "feedback") });
  if (error) throw new Error(error.message);
  refresh();
}

export async function removeProof(fd: FormData) {
  const profile = await getProfile();
  if (profile?.role !== "admin") throw new Error("Admins only");
  const supabase = await createClient();
  const id = String(fd.get("id"));
  const { data: p } = await supabase.from("proofs").select("file_path").eq("id", id).single();
  const { error } = await supabase.from("proofs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  if (p?.file_path) await supabase.storage.from("proofs").remove([p.file_path]);
  refresh();
}
