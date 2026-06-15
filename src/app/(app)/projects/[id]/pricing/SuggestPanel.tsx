"use client";

/**
 * "Suggest prices with AI" — background job with live progress + cancel.
 * Suggestions land as 'proposed' (amber) and never touch confirmed prices.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startPricing, getPricingRun, cancelPricing } from "./actions";
import type { ScopeRun } from "../scope/actions";

export default function SuggestPanel({
  projectId,
  initialRun,
}: {
  projectId: string;
  initialRun: ScopeRun | null;
}) {
  const router = useRouter();
  const [run, setRun] = useState<ScopeRun | null>(initialRun);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    const latest = await getPricingRun(projectId);
    if (cancelledRef.current) return;
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

  async function onStart() {
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
    const res = await startPricing(projectId);
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
    await cancelPricing(projectId);
    setCancelling(false);
  }

  if (run?.status === "running") {
    return (
      <div className="glass w-full max-w-md rounded-xl p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-foreground">Suggesting prices…</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
            style={{ width: `${Math.min(100, Math.max(2, run.progress))}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-sm leading-relaxed text-foreground">{run.stage ?? "Working…"}</p>
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

  return (
    <div className="flex flex-col items-end gap-1.5">
      {run?.status === "error" && run.error ? (
        <p className="w-full max-w-md rounded-lg border border-brand/40 bg-brand/10 px-4 py-2.5 text-sm leading-relaxed text-brand-soft">
          {run.error}
        </p>
      ) : null}
      {run?.status === "cancelled" ? (
        <p className="w-full max-w-md rounded-lg border border-border bg-surface/40 px-4 py-2.5 text-sm text-muted">
          Suggestion cancelled.
        </p>
      ) : null}
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="glass-brand rounded-lg px-4 py-2 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
      >
        Suggest prices with AI
      </button>
      <p className="max-w-xs text-right text-[11px] text-muted/70">
        Fills unpriced &amp; unconfirmed lines only — confirmed prices are never
        touched. Every suggestion needs your confirm.
      </p>
    </div>
  );
}
