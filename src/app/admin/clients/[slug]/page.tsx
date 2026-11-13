import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClientTabs } from "@/components/ClientTabs";
import { ClientView } from "@/components/ClientView";

export default async function AdminClient({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string; period?: string; approved?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const preview = sp.view === "client";
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, name, is_active, notion_partner_name, customer_report_sheet_url, profiles(email)").eq("slug", slug).single();
  if (!client) notFound();
  const logins = (client.profiles as { email: string }[]) ?? [];
  return (
    <>
      <ClientTabs slug={slug} name={client.name} active={preview ? "client" : "team"} period={sp.period}
        meta={<>{client.is_active ? "Live" : "Past"} · {logins.length ? `${logins.length} client login${logins.length === 1 ? "" : "s"}` : "No client logins yet"}
          {client.customer_report_sheet_url && <> · <a className="text-navy hover:underline" href={client.customer_report_sheet_url} target="_blank" rel="noreferrer">Old report</a></>}</>} />
      <div className="mt-6">
        <ClientView clientId={client.id} clientName={client.name} showAll preview={preview} approvedOnly={sp.approved === "1"} period={sp.period ?? null} editHref={`/admin/enter?client=${slug}`}
          basePath={`/admin/clients/${slug}?${preview ? "view=client&" : ""}${preview && sp.approved === "1" ? "approved=1&" : ""}`} />
      </div>
    </>
  );
}
