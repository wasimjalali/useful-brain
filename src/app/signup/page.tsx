import { getCloudflareContext } from "@opennextjs/cloudflare";

import { AuthForm } from "@/components/auth/auth-form";
import { DemoSignInReload } from "@/components/auth/demo-sign-in-reload";
import { isDemoMode } from "@/lib/demo/demo-mode";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const { env } = await getCloudflareContext({ async: true });
  if (isDemoMode(env as { DEMO_MODE?: string })) {
    return <DemoSignInReload />;
  }
  return <AuthForm mode="signup" />;
}
