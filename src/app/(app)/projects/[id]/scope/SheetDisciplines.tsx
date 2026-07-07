"use client";

/**
 * Collapsible "Plan sheets" panel — shows each kept sheet and lets the user
 * CORRECT its discipline. The discipline decides which sheets each CSI-division
 * draft pass reads (see src/lib/scope/routing.ts), so a mis-sorted sheet can be
 * fixed here instead of silently steering the AI wrong. Optional: the AI works
 * fine on the auto-classified defaults; this is only for corrections.
 */
import { useMemo, useState } from "react";
import {
  DISCIPLINE_OPTIONS,
  asDiscipline,
  classifyDiscipline,
} from "@/lib/scope/discipline";
import { setSheetDiscipline } from "./actions";

export type SheetRow = {
  id: string;
  page_number: number;
  name: string | null;
  label: string | null;
  discipline: string | null;
};

export default function SheetDisciplines({ sheets }: { sheets: SheetRow[] }) {
  const [open, setOpen] = useState(false);
  // Local override of each sheet's discipline for optimistic UI.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");

  // Current discipline per sheet: local pick → stored value → derived guess.
  const disciplineFor = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sheets)
      m[s.id] =
        chosen[s.id] ??
        asDiscipline(s.discipline) ??
        classifyDiscipline(s.name, s.label);
    return m;
  }, [sheets, chosen]);

  if (!sheets.length) return null;

  async function onChange(id: string, value: string) {
    setChosen((p) => ({ ...p, [id]: value }));
    setErr("");
    const res = await setSheetDiscipline(id, value);
    if (!res.ok) setErr(res.error ?? "Could not save.");
  }

  const routedCount = sheets.filter(
    (s) => !["general", "schedules", "architectural", "unknown"].includes(disciplineFor[s.id]),
  ).length;

  return (
    <div className="mt-6 rounded-xl glass">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm text-foreground">
          Plan sheets{" "}
          <span className="text-muted">
            · {sheets.length} sheet{sheets.length === 1 ? "" : "s"}, {routedCount}{" "}
            trade-routed
          </span>
        </span>
        <span className="text-xs text-muted">{open ? "Hide" : "Review disciplines"}</span>
      </button>

      {open ? (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-3 text-xs text-muted">
            Each sheet is auto-sorted by discipline so the AI reads only the
            relevant sheets per trade (cover, notes, schedules and architectural
            always go to every trade). Fix any that look wrong.
          </p>
          {err ? (
            <p className="mb-3 rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs text-brand-soft">
              {err}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {sheets.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5"
              >
                <span className="min-w-0 truncate text-sm text-foreground">
                  {s.name?.trim() || s.label?.trim() || `Sheet ${s.page_number}`}
                  <span className="ml-2 text-xs text-muted">p.{s.page_number}</span>
                </span>
                <select
                  value={disciplineFor[s.id]}
                  onChange={(e) => onChange(s.id, e.target.value)}
                  className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
                >
                  {DISCIPLINE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
