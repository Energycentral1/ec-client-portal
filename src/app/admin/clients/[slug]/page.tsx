import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClientView } from "@/components/ClientView";

export default async function AdminClient({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, name, is_active, notion_partner_name, customer_report_sheet_url, profiles(email)").eq("slug", slug).single();
  if (!client) notFound();
  const logins = (client.profiles as { email: string }[]) ?? [];
  return (
    <>
      <h1 className="text-2xl font-semibold">{client.name}</h1>
      <p className="mt-1 text-sm text-ink/60">
        {client.is_active ? "Live" : "Past"} · Notion name: {client.notion_partner_name ?? "none"} · Logins: {logins.length ? logins.map((l) => l.email).join(", ") : "none yet"}
        {client.customer_report_sheet_url && <> · <a className="text-navy hover:underline" href={client.customer_report_sheet_url} target="_blank" rel="noreferrer">Old report</a></>}
      </p>
      <div className="mt-6"><ClientView clientId={client.id} showAll /></div>
    </>
  );
}
