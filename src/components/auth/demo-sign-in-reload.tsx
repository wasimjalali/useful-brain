"use client";

import { useEffect, useSyncExternalStore } from "react";

const noSubscription = () => () => {};
const alreadyReloaded = () => new URL(window.location.href).searchParams.has("fresh");

/**
 * The demo has no sign-in form. A client-side visit here (sign out, or a
 * session the hourly cleanup removed) reloads the page as a full navigation,
 * which the web proxy answers with a fresh demo admin. `?fresh` stops a loop
 * when the browser sends no navigation headers.
 */
export function DemoSignInReload() {
  const stuck = useSyncExternalStore(noSubscription, alreadyReloaded, () => false);
  useEffect(() => {
    if (alreadyReloaded()) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("fresh", "1");
    window.location.replace(url.toString());
  }, []);
  return (
    <main className="mx-auto max-w-[32rem] px-4 pt-[20vh] text-[15px] leading-6 text-ink-muted">
      {stuck ? "The demo needs cookies turned on in a current browser." : "Opening the demo…"}
    </main>
  );
}
