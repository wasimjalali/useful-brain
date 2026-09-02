import type { Metadata } from "next";

import { OpenLanding } from "@/components/open/open-landing";

export const metadata: Metadata = {
  title: "Useful Brain",
  description:
    "A company knowledge agent that cites retrieved evidence and refuses unsupported claims.",
};

export default function OpenPage() {
  return <OpenLanding />;
}
