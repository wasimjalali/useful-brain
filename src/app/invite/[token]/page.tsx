import { InviteAcceptForm } from "@/components/auth/invite-accept-form";

export const dynamic = "force-dynamic";

export const metadata = { referrer: "no-referrer" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteAcceptForm token={token} />;
}
