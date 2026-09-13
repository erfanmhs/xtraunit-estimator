import Link from "next/link";
import type { Stage } from "@/lib/projects/overview";

/**
 * Where the job stands, in one slim strip: the six stages as a track with
 * the current one lit, and the single next action as a button. Nothing to
 * read — the how-to lives behind the "?" guide. Erfan, 2026-09-13: the
 * card version was "too big and not elegant".
 */
type Stages = {
  plans: Stage;
  takeoff: Stage;
  scope: Stage;
  pricing: Stage;
  estimate: Stage;
  proposal: Stage;
};

const ORDER: { key: keyof Stages; label: string }[] = [
  { key: "plans", label: "Plans" },
  { key: "takeoff", label: "Takeoff" },
  { key: "scope", label: "Scope" },
  { key: "pricing", label: "Pricing" },
  { key: "estimate", label: "Estimate" },
  { key: "proposal", label: "Proposal" },
];

export default function NextUp({
  projectId,
  stages,
  firstPlanId,
}: {
  projectId: string;
  stages: Stages;
  firstPlanId: string | null;
}) {
  const base = `/projects/${projectId}`;
  const current = ORDER.find((s) => stages[s.key] !== "done")?.key ?? null;

  // One verb, one destination.
  const next: { label: string; href: string | null } = (() => {
    switch (current) {
      case "plans":
        return { label: "Upload the plans", href: null }; // the upload box is right below
      case "takeoff":
        return { label: "Set the scale & measure", href: firstPlanId ? `${base}/plans/${firstPlanId}` : null };
      case "scope":
        return { label: "Generate the scope", href: `${base}/scope` };
      case "pricing":
        return { label: stages.pricing === "partial" ? "Confirm the prices" : "Price the scope", href: `${base}/pricing` };
      case "estimate":
        return { label: "Set the markups", href: `${base}/estimate` };
      case "proposal":
        return { label: "Build the proposal", href: `${base}/proposal` };
      default:
        return { label: "Send the proposal", href: `${base}/proposal` };
    }
  })();

  const doneCount = ORDER.filter((s) => stages[s.key] === "done").length;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {/* The track */}
      <ol className="flex min-w-0 flex-1 basis-64 items-center" aria-label={`${doneCount} of ${ORDER.length} stages done`}>
        {ORDER.map((s, i) => {
          const st = stages[s.key];
          const here = s.key === current;
          const done = st === "done";
          return (
            <li key={s.key} className="flex min-w-0 flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                    done
                      ? "bg-green-400 text-black"
                      : st === "partial"
                        ? "bg-amber-400 text-black"
                        : here
                          ? "bg-brand text-white ring-4 ring-brand/25"
                          : "border border-border text-muted"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={`text-[10px] leading-none ${here ? "font-medium text-foreground" : "text-muted"}`}>{s.label}</span>
              </div>
              {i < ORDER.length - 1 ? (
                <span aria-hidden className={`mx-1 mb-3.5 h-px min-w-3 flex-1 ${done ? "bg-green-400/60" : "bg-border"}`} />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* The one next action */}
      {next.href ? (
        <Link
          href={next.href}
          className="shrink-0 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
        >
          {next.label} →
        </Link>
      ) : (
        <span className="shrink-0 text-sm text-muted">
          Next: <span className="text-foreground">{next.label}</span> ↓
        </span>
      )}
    </div>
  );
}
