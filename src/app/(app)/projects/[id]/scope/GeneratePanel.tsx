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

const PHASES: { key: NonNullable<ScopeRun["detail"]>["phase"]; label: string }[] = [
  { key: "read", label: "Read plans" },
  { key: "draft", label: "Draft divisions" },
  { key: "review", label: "Review gaps" },
  { key: "save", label: "Save" },
];

/**
 * Live progress: the four phases, the elapsed clock, and — while drafting —
 * every division group with its state. Finished groups show how many lines
 * they produced and the first few, so the scope is visibly filling in rather
 * than a bar creeping along. Detail comes from the run's checkpoint; without
 * it (older DB) the stage text alone still shows.
 */
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
  const d = run.detail ?? null;
  const phaseIdx = d ? PHASES.findIndex((p) => p.key === d.phase) : -1;
  const doneGroups = d ? d.steps.filter((s) => s.status === "done").length : 0;

  return (
    <div className="glass w-full max-w-md rounded-xl p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-foreground">
          Generating scope…
          {d && d.attempt && d.attempt > 1 ? (
            <span className="ml-1.5 text-[11px] text-amber-300">resumed (attempt {d.attempt})</span>
          ) : null}
        </span>
        <span className="tabular-nums text-muted" aria-label="Elapsed">
          {mins}:{secs.toString().padStart(2, "0")}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
          style={{ width: `${Math.min(100, Math.max(2, run.progress))}%` }}
        />
      </div>

      {/* The four phases */}
      {d ? (
        <ol className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {PHASES.map((p, i) => {
            const state = i < phaseIdx ? "done" : i === phaseIdx ? "active" : "todo";
            return (
              <li
                key={p.key}
                className={`flex items-center gap-1 ${
                  state === "done" ? "text-green-300" : state === "active" ? "text-foreground" : "text-muted/60"
                }`}
              >
                <span aria-hidden>
                  {state === "done" ? "✓" : state === "active" ? "●" : "○"}
                </span>
                {p.label}
                {p.key === "draft" && d.steps.length ? (
                  <span className="tabular-nums text-muted">
                    {doneGroups}/{d.steps.length}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      <p className="mt-2 text-sm leading-relaxed text-foreground">{run.stage ?? "Working…"}</p>

      {/* Division groups, streaming in as each finishes */}
      {d && d.steps.length ? (
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-input p-2 text-xs">
          {d.steps.map((s) => (
            <div key={s.key} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={
                    s.status === "done"
                      ? "text-green-300"
                      : s.status === "active"
                        ? "animate-pulse text-brand-soft"
                        : "text-muted/50"
                  }
                >
                  {s.status === "done" ? "✓" : s.status === "active" ? "●" : "○"}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    s.status === "pending" ? "text-muted/70" : "text-foreground"
                  }`}
                >
                  Div {s.label}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {s.status === "done"
                    ? `${s.lines} line${s.lines === 1 ? "" : "s"}`
                    : s.status === "active"
                      ? "drafting…"
                      : ""}
                </span>
              </div>
              {s.sample.length ? (
                <ul className="ml-5 text-[11px] leading-snug text-muted/80">
                  {s.sample.map((t, i) => (
                    <li key={i} className="truncate">
                      · {t}
                    </li>
                  ))}
                  {s.lines > s.sample.length ? (
                    <li className="text-muted/50">… and {s.lines - s.sample.length} more</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ))}
          {d.linesSoFar > 0 ? (
            <p className="border-t border-border pt-1 text-[11px] text-muted">
              {d.linesSoFar} lines drafted so far
              {d.findingsSoFar ? ` · ${d.findingsSoFar} findings` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

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
  // Free-text trades the user typed. Kept in `selected` like any other, so
  // nothing downstream has to know the difference - the AI maps the words.
  const [other, setOther] = useState("");
  const extras = selected.filter((t) => !DIVISIONS.includes(t));
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

  function addExtra() {
    const t = other.trim().slice(0, 80);
    if (!t || selected.includes(t)) {
      setOther("");
      return;
    }
    setSelected((prev) => [...prev, t]);
    setOther("");
  }

  function removeExtra(t: string) {
    setSelected((prev) => prev.filter((x) => x !== t));
  }

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

  // C5 - the button knows where it is in the job.
  //   nothing chosen yet          -> off
  //   no scope yet                -> "Generate Scope of Work"
  //   scope exists, nothing moved -> quiet; there is nothing to redo
  //   selection changed since     -> back to full strength as "Regenerate"
  const currentTrades = mode === "full" ? [] : selected;
  const sameAsLastRun =
    currentTrades.length === initialTrades.length &&
    currentTrades.every((t) => initialTrades.includes(t));
  // Switching to "Specific trades" before picking any is a choice in
  // progress, not a settled scope — even though the trade list is empty in
  // both, which is what an equality check alone would conclude.
  const modeMatchesLastRun = (initialTrades.length > 0) === (mode === "trades");
  const canGenerate = !busy && (mode === "full" || selected.length > 0);
  const settled = hasScope && sameAsLastRun && modeMatchesLastRun;

  return (
    <div className="flex w-full max-w-md flex-col items-start gap-3">
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

      {/* C3 - this is the top-level choice, and a sub-choice follows it when
          you pick "Specific trades". It used to be two chips the same size and
          weight as the 20 division chips underneath, so nothing said one was a
          category and the others were its contents. */}
      <div className="w-full">
        <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">
          What should the AI scope?
        </p>
        <div className="grid grid-cols-2 gap-2">
          <ModeCard
            active={mode === "full"}
            onClick={() => setMode("full")}
            title="Full building"
            hint="Every trade and division"
          />
          <ModeCard
            active={mode === "trades"}
            onClick={() => setMode("trades")}
            title="Specific trades"
            hint="Pick the divisions"
          />
        </div>
      </div>

      {mode === "trades" ? (
        <div className="w-full">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">
            Which trades?
          </p>
          <div className="flex flex-wrap justify-start gap-1">
            {DIVISIONS.map((d) => (
              <button key={d} type="button" onClick={() => toggle(d)} className={chip(selected.includes(d))}>
                {d}
              </button>
            ))}
            {/* Anything typed here goes to the AI as-is and it maps the words
                to the right CSI division. Nobody should have to know that a
                solar array is division 48. */}
            {extras.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => removeExtra(x)}
                title="Remove"
                className={`${chip(true)} whitespace-nowrap`}
              >
                {x} &times;
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addExtra();
                }
              }}
              placeholder="Other trade - describe it in your own words"
              aria-label="Other trade"
              className="min-w-0 flex-1 rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={addExtra}
              disabled={!other.trim()}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-foreground disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      ) : null}

      {settled ? (
        // Already generated and nothing has changed. Still reachable, but it
        // stops competing with the scope itself for attention.
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className="rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:text-brand-soft disabled:opacity-40"
        >
          Regenerate from scratch
        </button>
      ) : (
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/20 ring-1 ring-inset ring-white/15 transition-all hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          <SparkIcon />
          {hasScope ? "Regenerate Scope" : "Generate Scope of Work"}
          <span className="text-xs font-normal opacity-80">
            {mode === "full"
              ? "full building"
              : selected.length
                ? `${selected.length} trade${selected.length > 1 ? "s" : ""}`
                : "pick trades"}
          </span>
        </button>
      )}
    </div>
  );
}

/** The top-level "what am I scoping" choice - bigger than the chips below it. */
function ModeCard({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-brand bg-brand/15 text-foreground"
          : "border-border text-muted hover:border-brand/60 hover:text-foreground"
      }`}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-0.5 block text-[11px] opacity-80">{hint}</span>
    </button>
  );
}

function SparkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}
