"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { shouldStartNavigation, type NavigationClickIntent } from "./navigation-progress-intent";

// A deliberately subtle 2px top bar that gives every soft navigation immediate
// feedback. The App Router keeps the previous page on screen until the
// destination's server work resolves; this bar acknowledges the click the moment
// it happens so navigation no longer feels "sticky".
export function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [width, setWidth] = useState(0);
  const trickleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (trickleTimer.current) clearInterval(trickleTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    trickleTimer.current = null;
    hideTimer.current = null;
  }, []);

  const start = useCallback(() => {
    clearTimers();
    setActive(true);
    setWidth(8);
    // Ease toward 90% so the bar always shows motion without ever pretending the
    // navigation is finished before the new path actually arrives.
    trickleTimer.current = setInterval(() => {
      setWidth((current) => (current >= 90 ? current : current + (90 - current) * 0.15));
    }, 200);
  }, [clearTimers]);

  const finish = useCallback(() => {
    clearTimers();
    setWidth(100);
    hideTimer.current = setTimeout(() => {
      setActive(false);
      setWidth(0);
    }, 250);
  }, [clearTimers]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const intent: NavigationClickIntent = {
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        hasDownload: anchor.hasAttribute("download"),
        currentHref: window.location.href,
        isModified:
          event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
      };
      if (shouldStartNavigation(intent)) start();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [start]);

  // Completing on a real pathname change keeps the bar honest: it only finishes
  // once the destination is actually on screen. `finish` is referentially stable,
  // so this effect runs only when the path changes.
  useEffect(() => {
    finish();
  }, [pathname, finish]);

  useEffect(() => clearTimers, [clearTimers]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2px]"
      style={{ opacity: active ? 1 : 0, transition: "opacity 200ms ease 150ms" }}
    >
      <div
        className="h-full bg-[#3a5fd9]"
        style={{ width: `${width}%`, transition: "width 200ms ease" }}
      />
    </div>
  );
}
