"use client";

/**
 * The estimate: division subtotals (computed live from priced scope lines) and
 * the markup waterfall — contingency → insurance → overhead → profit — each
 * applied to the running total, ending in the grand total (the bid number).
 * Markup cells take formulas like the pricing cells. Export downloads a CSV
 * that opens straight in Excel (full line detail + the waterfall).
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { saveMarkups, type Markups } from "./actions";
import { lineTotal, type PricedLine } from "../pricing/PricingTable";
import { evalFormula } from "@/lib/formula";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Overhead & Profit shown as ONE line (Erfan's call); the combined % is stored
// in overhead_pct and profit_pct is kept at 0.
const MARKUP_ROWS = [
  ["contingency_pct", "Contingency"],
  ["insurance_pct", "Insurance"],
  ["overhead_pct", "Overhead & Profit"],
] as const;

function hasPrice(li: PricedLine): boolean {
  return li.price_status === "proposed" || li.price_status === "confirmed";
}

export default function EstimateView({
  projectId,
  projectName,
  lines,
  initialMarkups,
  initialBuildingSf,
}: {
  projectId: string;
  projectName: string;
  lines: PricedLine[];
  initialMarkups: Markups;
  initialBuildingSf: number | null;
}) {
  // Fold any previously-saved separate profit % into the combined O&P line.
  const combine = (m: Markups): Markups => ({
    ...m,
    overhead_pct: m.overhead_pct + m.profit_pct,
    profit_pct: 0,
  });
  const [pcts, setPcts] = useState<Record<string, string>>(() => ({
    contingency_pct: String(initialMarkups.contingency_pct),
    insurance_pct: String(initialMarkups.insurance_pct),
    overhead_pct: String(
      initialMarkups.overhead_pct + initialMarkups.profit_pct,
    ),
  }));
  const [saved, setSaved] = useState<Markups>(combine(initialMarkups));
  const [sf, setSf] = useState(
    initialBuildingSf ? String(initialBuildingSf) : "",
  );
  const [savedSf, setSavedSf] = useState<number | null>(initialBuildingSf);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setSaved(combine(initialMarkups));
    setPcts({
      contingency_pct: String(initialMarkups.contingency_pct),
      insurance_pct: String(initialMarkups.insurance_pct),
      overhead_pct: String(
        initialMarkups.overhead_pct + initialMarkups.profit_pct,
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMarkups]);

  // Live percentage values (formula-evaluated; fall back to last saved).
  const pct = useMemo(() => {
    const out: Markups = { ...saved };
    for (const [k] of MARKUP_ROWS) {
      const v = evalFormula(pcts[k]);
      if (v != null && v >= 0 && v <= 100) out[k] = v;
    }
    return out;
  }, [pcts, saved]);

  const sfVal = evalFormula(sf);

  function persistIfChanged() {
    const sfChanged = (sfVal ?? null) !== savedSf;
    const changed = MARKUP_ROWS.some(([k]) => pct[k] !== saved[k]) || sfChanged;
    if (!changed) return;
    const next = { ...pct };
    const nextSf = sfVal ?? null;
    setError(null);
    startTransition(async () => {
      const res = await saveMarkups(projectId, next, nextSf);
      if (res.ok) {
        setSaved(next);
        setSavedSf(nextSf);
      } else setError(res.error ?? "Could not save markups.");
    });
  }

  // Division subtotals from priced lines.
  const priced = lines.filter(hasPrice);
  const divisions = useMemo(() => {
    const out: { key: string; total: number }[] = [];
    for (const li of priced) {
      const key = `${li.division_code ?? "—"} · ${li.division_name ?? "Other"}`;
      let d = out.find((x) => x.key === key);
      if (!d) {
        d = { key, total: 0 };
        out.push(d);
      }
      d.total += lineTotal(li);
    }
    return out;
  }, [priced]);

  const subtotal = divisions.reduce((a, d) => a + d.total, 0);
  const unpriced = lines.length - priced.length;
  const unconfirmed = lines.filter((li) => li.price_status === "proposed").length;

  // The waterfall: each markup applies to the running total.
  const steps: { label: string; pctVal: number; amount: number; running: number }[] =
    [];
  let running = subtotal;
  for (const [k, label] of MARKUP_ROWS) {
    const amount = running * (pct[k] / 100);
    running += amount;
    steps.push({ label, pctVal: pct[k], amount, running });
  }
  const grandTotal = running;

  // Cost mix — where the direct cost sits across the five buckets.
  // Total-only lines can't be split, so they're shown as "unsplit".
  const mix = useMemo(() => {
    const m = { Labor: 0, Material: 0, Subcontractor: 0, Equipment: 0, Other: 0, Unsplit: 0 };
    for (const li of priced) {
      const mode = li.price_mode ?? "unit";
      if (mode === "total") {
        m.Unsplit += li.cost_total ?? 0;
        continue;
      }
      const f = mode === "lump" ? 1 : (li.quantity ?? 0);
      m.Labor += f * (li.cost_labor ?? 0);
      m.Material += f * (li.cost_material ?? 0);
      m.Subcontractor += f * (li.cost_sub ?? 0);
      m.Equipment += f * (li.cost_equipment ?? 0);
      m.Other += f * (li.cost_other ?? 0);
    }
    return m;
  }, [priced]);

  function exportCsv() {
    const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows: string[] = [];
    rows.push(
      [
        "Division",
        "Description",
        "Qty",
        "Unit",
        "Mode",
        "Labor",
        "Material",
        "Subcontractor",
        "Equipment",
        "Other",
        "Total ($)",
        "Status",
        "Source",
      ]
        .map(q)
        .join(","),
    );
    for (const li of lines) {
      rows.push(
        [
          `${li.division_code ?? ""} ${li.division_name ?? ""}`.trim(),
          li.description,
          li.quantity ?? "",
          li.unit ?? "",
          li.price_mode ?? "",
          li.cost_labor ?? "",
          li.cost_material ?? "",
          li.cost_sub ?? "",
          li.cost_equipment ?? "",
          li.cost_other ?? "",
          hasPrice(li) ? lineTotal(li).toFixed(2) : "",
          li.price_status ?? "",
          li.price_source ?? "",
        ]
          .map(q)
          .join(","),
      );
    }
    rows.push("");
    rows.push([q("Direct cost subtotal"), "", "", "", "", "", "", "", "", "", q(subtotal.toFixed(2))].join(","));
    for (const s of steps) {
      rows.push(
        [q(`${s.label} (${s.pctVal}%)`), "", "", "", "", "", "", "", "", "", q(s.amount.toFixed(2))].join(","),
      );
    }
    rows.push([q("GRAND TOTAL"), "", "", "", "", "", "", "", "", "", q(grandTotal.toFixed(2))].join(","));
    rows.push("");
    rows.push([q("Cost mix (direct)"), "", "", "", "", "", "", "", "", "", ""].join(","));
    for (const [label, v] of Object.entries(mix)) {
      if (v > 0)
        rows.push([q(label === "Unsplit" ? "Total-only lines" : label), "", "", "", "", "", "", "", "", "", q(v.toFixed(2))].join(","));
    }
    if (sfVal && sfVal > 0) {
      rows.push([q(`Building area (sf)`), "", "", "", "", "", "", "", "", "", q(sfVal.toFixed(0))].join(","));
      rows.push([q(`Cost per SF`), "", "", "", "", "", "", "", "", "", q((grandTotal / sfVal).toFixed(2))].join(","));
    }

    // BOM so Excel opens it as UTF-8.
    const blob = new Blob(["﻿" + rows.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${projectName.replace(/[^\w\- ]+/g, "").trim() || "estimate"} — Estimate.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="mt-6 space-y-6">
      {error ? (
        <p className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
          {error}
        </p>
      ) : null}

      {unpriced > 0 || unconfirmed > 0 ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          {unpriced > 0 ? `${unpriced} scope lines are unpriced and NOT in this estimate. ` : ""}
          {unconfirmed > 0 ? `${unconfirmed} prices are unconfirmed (still included — confirm them on the Pricing page).` : ""}
        </p>
      ) : null}

      {/* Division subtotals */}
      <section className="glass rounded-xl p-4">
        <h2 className="mb-2 font-heading text-sm uppercase tracking-wider text-brand-soft">
          Direct cost by division
        </h2>
        <div className="divide-y divide-white/5">
          {divisions.map((d) => (
            <div key={d.key} className="flex items-center justify-between py-2 text-sm">
              <span className="text-foreground">{d.key}</span>
              <span className="text-muted">
                {usd.format(d.total)}
                <span className="ml-2 inline-block w-10 text-right text-[11px] text-muted/60">
                  {subtotal > 0 ? `${Math.round((d.total / subtotal) * 100)}%` : ""}
                </span>
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between py-2.5 text-sm font-medium">
            <span className="text-foreground">Direct cost subtotal</span>
            <span className="text-foreground">{usd.format(subtotal)}</span>
          </div>
        </div>

        {/* Cost mix — labor vs material vs subs at a glance */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-xs text-muted">
          {Object.entries(mix)
            .filter(([, v]) => v > 0)
            .map(([label, v]) => (
              <span key={label}>
                {label === "Unsplit" ? "Total-only lines" : label}:{" "}
                <span className="text-foreground">{usd.format(v)}</span>
                {subtotal > 0 ? (
                  <span className="text-muted/60"> ({Math.round((v / subtotal) * 100)}%)</span>
                ) : null}
              </span>
            ))}
        </div>
      </section>

      {/* Markup waterfall */}
      <section className="glass rounded-xl p-4">
        <h2 className="mb-2 font-heading text-sm uppercase tracking-wider text-brand-soft">
          Markups
        </h2>
        <div className="divide-y divide-white/5">
          {MARKUP_ROWS.map(([k, label], i) => (
            <div key={k} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-28 text-foreground">{label}</span>
              <label className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={pcts[k]}
                  onChange={(e) =>
                    setPcts((p) => ({ ...p, [k]: e.target.value }))
                  }
                  onBlur={persistIfChanged}
                  className="w-20 rounded-md border border-border bg-black/20 px-2 py-1 text-right text-sm text-foreground outline-none focus:border-brand"
                />
                <span className="text-muted">%</span>
              </label>
              <span className="ml-auto text-muted">
                + {usd.format(steps[i].amount)}
              </span>
              <span className="w-32 text-right text-foreground">
                {usd.format(steps[i].running)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-brand/15 px-4 py-3">
          <span className="font-heading text-base text-foreground">
            Grand total (bid)
          </span>
          <span className="font-heading text-2xl text-brand-soft">
            {usd.format(grandTotal)}
          </span>
        </div>

        {/* $/SF benchmark */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
          <label className="flex items-center gap-2 text-muted">
            Building area
            <input
              type="text"
              inputMode="decimal"
              value={sf}
              onChange={(e) => setSf(e.target.value)}
              onBlur={persistIfChanged}
              placeholder="e.g. 12500"
              className="w-28 rounded-md border border-border bg-black/20 px-2 py-1 text-right text-sm text-foreground outline-none focus:border-brand"
            />
            sf
          </label>
          <span className="text-muted">
            {sfVal && sfVal > 0 ? (
              <>
                <span className="font-medium text-foreground">
                  {usd.format(grandTotal / sfVal)}
                </span>{" "}
                / SF
              </>
            ) : (
              "enter the area for $/SF"
            )}
          </span>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={exportCsv}
          className="glass-brand rounded-lg px-4 py-2 text-sm font-medium text-foreground hover:bg-brand/30"
        >
          Export to Excel (CSV)
        </button>
      </div>
    </div>
  );
}
