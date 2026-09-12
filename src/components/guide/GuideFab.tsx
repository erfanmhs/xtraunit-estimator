"use client";

/**
 * The "?" that lives on every signed-in screen — bottom right, above the
 * phone tab bar. Opens the Guide for whichever page you're on. Pulses until
 * it has been opened once on this device, then sits quietly.
 *
 * Other components open it by dispatching `xu:guide` on window (the welcome
 * card on the Projects page does).
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { guideFor } from "@/lib/guide/content";
import GuidePanel from "./GuidePanel";

const SEEN = "xu-guide-opened";
const listeners = new Set<() => void>();
function readSeen(): boolean {
  try {
    return !!localStorage.getItem(SEEN);
  } catch {
    return true; // no storage → no pulse, rather than a pulse forever
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {
    /* private mode — the pulse just comes back next visit */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export default function GuideFab() {
  const pathname = usePathname();
  // "Open for this route": navigating away closes it without an effect, so
  // the panel never shows the wrong page's guide.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  // Server renders "seen" (no pulse); the client corrects after hydration.
  const seen = useSyncExternalStore(subscribe, readSeen, () => true);

  const show = useCallback(() => {
    setOpenFor(pathname);
    markSeen();
  }, [pathname]);

  useEffect(() => {
    const on = () => show();
    window.addEventListener("xu:guide", on);
    return () => window.removeEventListener("xu:guide", on);
  }, [show]);

  const fresh = !seen;
  const { key, projectId } = guideFor(pathname);
  // The takeoff viewer needs every pixel; sit a little higher there so the
  // button clears its bottom tool strip.
  const viewer = pathname.includes("/plans/");

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label="Open the guide for this page"
        title="Guide: what to do on this page"
        className={`fixed right-4 z-30 flex items-center justify-center rounded-full border border-brand/40 bg-brand text-white shadow-lg shadow-brand/30 transition-transform hover:scale-105 sm:bottom-6 ${
          viewer
            ? "bottom-[calc(7.5rem+env(safe-area-inset-bottom))] h-10 w-10 opacity-80 hover:opacity-100"
            : "bottom-[calc(4.25rem+env(safe-area-inset-bottom))] h-12 w-12"
        }`}
      >
        {fresh ? (
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand/60 motion-reduce:hidden" />
        ) : null}
        <span className="relative font-heading text-xl leading-none">?</span>
      </button>
      {open ? <GuidePanel initialKey={key} projectId={projectId} pathname={pathname} onClose={() => setOpenFor(null)} /> : null}
    </>
  );
}
