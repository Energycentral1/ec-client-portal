import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { Shell, Empty } from "@/components/Shell";
import { ClientView } from "@/components/ClientView";

export default async function Portal({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "admin") redirect("/admin");
  const supabase = await createClient();
  const { data: client } = profile.client_id
    ? await supabase.from("clients").select("id, name").eq("id", profile.client_id).single()
    : { data: null };
  return (
    <Shell title={client?.name ?? "Client Portal"} email={profile.email} nav={[]}>
      {!client ? <Empty>Your login isn&apos;t linked to a company yet. Your Energy Central account manager can fix that.</Empty> : (
        <>
          <ClientView clientId={client.id} clientName={client.name} showAll={false} period={period ?? null} basePath="/portal?" />
        </>
      )}
    </Shell>
  );
}
