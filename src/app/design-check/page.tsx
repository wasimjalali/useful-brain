import { notFound } from "next/navigation";

import { DesignCheckPanel } from "./design-check-panel";

export const metadata = { title: "Design check" };

export default function DesignCheckPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return (
    <div className="grid gap-4 p-4 min-[1100px]:grid-cols-2">
      <DesignCheckPanel theme="light" />
      <DesignCheckPanel theme="dark" />
    </div>
  );
}
