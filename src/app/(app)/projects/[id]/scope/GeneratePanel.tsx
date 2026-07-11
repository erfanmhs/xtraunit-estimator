"use client";

/**
 * Scope selector + generate button + live progress (background job).
 * You can generate the FULL building or pick SPECIFIC trades — a trade-only run
 * replaces just those trades and leaves the rest of the scope intact.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startScope, getScopeRun, cancelScope, type ScopeRun } from "./actions";

// Common CSI trades. The leading 2-digit code is the division_code we store.
const DIVISIONS = [
  "02 Existing Conditions / Demolition",
  "03 Concrete",
  "04 Masonry",
  "05 Metals",
  "06 Wood & Plastics",
  "07 Thermal & Moisture (roofing/insulation)",
  "08 Openings (doors & windows)",
  "09 Finishes",
  "10 Specialties",
  "21 Fire Suppression",
  "22 Plumbing",
  "23 HVAC",
  "26 Electrical",
  "31 Earthwork / Sitework",
  "32 Exterior Improvements",
];

function chip(active: boolean) {
  return `rounded-md border px-2 py-1 text-xs transition-colors ${
    active
      ? "border-brand bg-brand/20 text-foreground"
      : "border-border text-muted hover:border-brand"
  }`;
}

function Progress({
  run,
  onCancel,
  cancelling,
}: {
  run: ScopeRun;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(
    0,
    Math.floor((now - new Date(run.created_at).getTime()) / 1000),
  );
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return (
    <div className="glass w-full max-w-md rounded-xl p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-foreground">Generating scope…</span>
        <span className="text-muted">
          {mins}:{secs.toString().padStart(2, "0")}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
          style={{ width: `${Math.min(100, Math.max(2, run.progress))}%` }}
        />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-foreground">{run.stage ?? "Working…"}</p>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[11px] text-muted/70">
          You can leave this page — it keeps generating in the background.
        </p>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-brand-soft disabled:opacity-50"
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

export default function GeneratePanel({
  projectId,
  initialRun,
  hasScope,
  initialTrades = [],
}: {
  projectId: string;
  initialRun: ScopeRun | null;
  hasScope: boolean;
  initialTrades?: string[];
}) {
  const router = useRouter();
  const [run, setRun] = useState<ScopeRun | null>(initialRun);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Default back to the project's last-used trade selection so a Regenerate
  // doesn't forget the trades this estimate was scoped for.
  const [mode, setMode] = useState<"full" | "trades">(
    initialTrades.length ? "trades" : "full",
  );
  const [selected, setSelected] = useState<string[]>(initialTrades);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set when the user cancels, so an in-flight poll() can't overwrite the
  // cancelled state with a stale "running" read.
  const cancelledRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    const latest = await getScopeRun(projectId);
    if (cancelledRef.current) return; // user cancelled mid-poll — ignore.
    setRun(latest);
    if (!latest || latest.status !== "running") {
      stopPolling();
      if (latest?.status === "done") router.refresh();
    }
  }, [projectId, router, stopPolling]);

  useEffect(() => {
    if (run?.status === "running" && !timer.current) {
      timer.current = setInterval(poll, 2500);
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  function toggle(d: string) {
    setSelected((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]));
  }

  async function onGenerate() {
    const trades = mode === "full" ? [] : selected;
    cancelledRef.current = false;
    setBusy(true);
    setRun({
      id: "pending",
      status: "running",
      stage: "Starting…",
      progress: 2,
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const res = await startScope(projectId, trades);
    setBusy(false);
    if (!res.ok) {
      setRun({
        id: "err",
        status: "error",
        stage: null,
        progress: 0,
        error: res.error ?? "Could not start.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return;
    }
    poll();
  }

  async function onCancel() {
    // Optimistic: stop the spinner immediately, then tell the server to abort.
    cancelledRef.current = true;
    setCancelling(true);
    stopPolling();
    setRun({
      id: run?.id ?? "cancelled",
      status: "cancelled",
      stage: "Cancelled",
      progress: 100,
      error: null,
      created_at: run?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await cancelScope(projectId);
    setCancelling(false);
  }

  if (run?.status === "running")
    return <Progress run={run} onCancel={onCancel} cancelling={cancelling} />;

  const canGenerate = !busy && (mode === "full" || selected.length > 0);

  return (
    <div className="flex w-full max-w-md flex-col items-end gap-2">
      {run?.status === "error" && run.error ? (
        <p className="w-full rounded-lg border border-brand/40 bg-brand/10 px-4 py-2.5 text-sm leading-relaxed text-brand-soft">
          {run.error}
        </p>
      ) : null}
      {run?.status === "cancelled" ? (
        <p className="w-full rounded-lg border border-border bg-surface/40 px-4 py-2.5 text-sm text-muted">
          Generation cancelled.
        </p>
      ) : null}

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setMode("full")} className={chip(mode === "full")}>
          Full building
        </button>
        <button
          type="button"
          onClick={() => setMode("trades")}
          className={chip(mode === "trades")}
        >
          Specific trades
        </button>
      </div>

      {mode === "trades" ? (
        <div className="flex flex-wrap justify-end gap-1">
          {DIVISIONS.map((d) => (
            <button key={d} type="button" onClick={() => toggle(d)} className={chip(selected.includes(d))}>
              {d}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="glass-brand rounded-lg px-4 py-2 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
      >
        {hasScope ? "Regenerate" : "Generate"}
        {mode === "full"
          ? " — full building"
          : selected.length
            ? ` — ${selected.length} trade${selected.length > 1 ? "s" : ""}`
            : " — pick trades"}
      </button>
    </div>
  );
}
