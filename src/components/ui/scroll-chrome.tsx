"use client";

import { useEffect, useRef } from "react";

/**
 * Scrollbar visibility, matching Useful Voice's ThinScroller: `.uv-scroll`
 * containers show their thumb only while scrolling and fade it out after
 * a short idle. CSS alone cannot express "hidden until scrolled" in
 * WebKit, so one delegated listener toggles `.is-scrolling` on any
 * `.uv-scroll` element that scrolls; globals.css owns the visual states.
 */
export function ScrollChrome() {
  const timers = useRef(new Map<Element, number>());

  useEffect(() => {
    const idle = timers.current;
    const fadeMs = 700;

    function reveal(element: Element) {
      element.classList.add("is-scrolling");
      const existing = idle.get(element);
      if (existing) {
        window.clearTimeout(existing);
      }
      idle.set(
        element,
        window.setTimeout(() => {
          element.classList.remove("is-scrolling");
          idle.delete(element);
        }, fadeMs),
      );
    }

    function onScroll(event: Event) {
      const target = event.target as Element | null;
      if (target && target.classList.contains("uv-scroll")) {
        reveal(target);
      }
    }

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      idle.forEach((timer) => window.clearTimeout(timer));
      idle.clear();
    };
  }, []);

  return null;
}
