import { StartForm } from "./StartForm";
import { LoginFrame } from "@/components/LoginFrame";

/** Landing page for a one-time link from /admin/logins. The link is only used when the person presses the button, so a chat
 *  or email app that previews the link does not use it up. */
export default async function Start({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const sp = await searchParams;
  return (
    <LoginFrame>
      <StartForm tokenHash={sp.token_hash ?? ""} type={sp.type === "invite" ? "invite" : "recovery"} />
    </LoginFrame>
  );
}
