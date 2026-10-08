import { redirect } from "next/navigation";

import { LEGACY_REDIRECTS } from "@/app/redirects";

export default function LegacyRedirect() {
  redirect(LEGACY_REDIRECTS["/evaluations"]);
}
