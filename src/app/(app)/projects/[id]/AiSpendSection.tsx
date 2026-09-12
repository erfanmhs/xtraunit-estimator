"use client";

/**
 * "AI spend" on the project page: the total at a glance, and every run
 * behind a caret. The total is what the AI has cost on THIS project so far;
 * it moves the moment a generation finishes, because each run writes its own
 * cost when it ends (src/lib/ai-meter.ts → scope_runs.cost_usd).
 *
 * Honest about what it does not know: a run from before cost tracking
 * existed shows a dash, and the heading says how many of those there are.
 */
import { useState } from "react";
import Caret from "@/components/Caret";

type Run = {
  id: string;
  kind: string | null;
  status: string | null;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  ai_calls: number | null;
  created_at: string;
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("en-US");

const KIND_LABEL: Record<string, string> = {
  scope: "Scope of work",
  apply: "Apply findings",
  pricing: "Pricing suggestions",
};

export default function AiSpendSection({
  totalUsd,
  costedRuns,
  uncostedRuns,
  runs,
}: {
  totalUsd: number;
  costedRuns: number;
  uncostedRuns: number;
  runs: Run[];
}) {
  const [open, setOpen] = useState(false);
  if (runs.length === 0) return null;

  const tokensIn = runs.reduce((a, r) => a + (r.tokens_in ?? 0), 0);
  const tokensOut = runs.reduce((a, r) => a + (r.tokens_out ?? 0), 0);

  return (
    <section className="rounded-xl panel p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <Caret open={open} size={20} />
        <h2 className="font-heading text-lg text-foreground">AI spend</h2>
        <span className="ml-auto text-right">
          <span className="font-heading text-lg text-foreground">{usd.format(totalUsd)}</span>
          <span className="block text-xs text-muted">
            {costedRuns} {costedRuns === 1 ? "run" : "runs"}
            {uncostedRuns ? ` · ${uncostedRuns} before cost tracking` : ""}
          </span>
        </span>
      </button>

      {open ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-xs text-muted">
            Anthropic&apos;s token counts for each run, priced at the model&apos;s list rate per
            million tokens (cached tokens at their cheaper rate). Updates the moment a
            generation finishes. Your Anthropic invoice is the ground truth; this should
            match it to the cent.
          </p>
          <div className="text-xs text-muted">
            {num.format(tokensIn)} tokens in · {num.format(tokensOut)} tokens out
          </div>
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className="min-w-0 flex-1 text-foreground">
                  {(r.kind && KIND_LABEL[r.kind]) || r.kind || "AI run"}
                  {r.status && r.status !== "done" ? (
                    <span className="ml-2 text-[11px] text-muted">{r.status}</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted">
                  {new Date(r.created_at).toLocaleDateString()}
                  {r.ai_calls ? ` · ${r.ai_calls} ${r.ai_calls === 1 ? "call" : "calls"}` : ""}
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-foreground">
                  {r.cost_usd == null ? <span className="text-muted">—</span> : usd.format(r.cost_usd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
