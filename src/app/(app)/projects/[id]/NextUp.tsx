import Link from "next/link";
import type { Stage } from "@/lib/projects/overview";

/**
 * "Next up" — the one thing to do now on this project, worked out from what
 * is already done, with the six stages as a row of ticks. Server-rendered
 * from the same stage data the cards and the rail use, so all three agree.
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

  // What to do, where to click, and where the button goes.
  const step: { title: string; how: string; href: string | null; cta: string } = (() => {
    switch (current) {
      case "plans":
        return {
          title: "Upload the plans",
          how: "Click “＋ Upload or drop a plan PDF” below (or “Photograph a sheet” on a phone), then sort the pages when asked.",
          href: null,
          cta: "",
        };
      case "takeoff":
        return {
          title: "Set the scale and measure the drivers",
          how: "Open a sheet, pick its scale in the “Scale” box, then measure 5–10 things that drive the job: floor area, exterior walls, roof, windows and doors.",
          href: firstPlanId ? `${base}/plans/${firstPlanId}` : null,
          cta: "Open the takeoff",
        };
      case "scope":
        return {
          title: "Generate the scope",
          how: "Choose “Full building” or “Specific trades”, click “Generate Scope of Work”, then read it trade by trade and answer the questions.",
          href: `${base}/scope`,
          cta: "Go to Scope",
        };
      case "pricing":
        return {
          title: stages.pricing === "partial" ? "Confirm the prices" : "Price the scope",
          how: "“Suggest prices with AI” fills the lines; tap each one to check it and confirm with the ✓. Add sub quotes with “+ Add Quote”.",
          href: `${base}/pricing`,
          cta: "Go to Pricing",
        };
      case "estimate":
        return {
          title: "Set the markups",
          how: "Contingency, insurance, overhead & profit as percentages, plus the building square footage for the $/SF check.",
          href: `${base}/estimate`,
          cta: "Go to Estimate",
        };
      case "proposal":
        return {
          title: "Build the proposal",
          how: "“Draft summary with AI”, fill in the dates and timeline, check the preview, then “Publish client link” or save as PDF.",
          href: `${base}/proposal`,
          cta: "Go to Proposal",
        };
      default:
        return {
          title: "Proposal ready",
          how: "Send the client link or the PDF. When the client answers, mark the project Sent, Won or Lost from the Projects page.",
          href: `${base}/proposal`,
          cta: "Open the proposal",
        };
    }
  })();

  const doneCount = ORDER.filter((s) => stages[s.key] === "done").length;

  return (
    <section className="rounded-xl border border-brand/30 bg-brand/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-[11px] uppercase tracking-wider text-brand-soft">
            Next up · {doneCount} of {ORDER.length} stages done
          </p>
          <h2 className="mt-0.5 font-heading text-lg text-foreground">{step.title}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">{step.how}</p>
        </div>
        {step.href ? (
          <Link
            href={step.href}
            className="shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
          >
            {step.cta} →
          </Link>
        ) : null}
      </div>

      <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {ORDER.map((s, i) => {
          const st = stages[s.key];
          const here = s.key === current;
          return (
            <li key={s.key} className={`flex items-center gap-1.5 ${here ? "text-foreground" : "text-muted"}`}>
              <span
                aria-hidden
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  st === "done"
                    ? "bg-green-400 text-black"
                    : st === "partial"
                      ? "bg-amber-400 text-black"
                      : here
                        ? "bg-brand text-white"
                        : "border border-border"
                }`}
              >
                {st === "done" ? "✓" : i + 1}
              </span>
              <span className={here ? "font-medium" : ""}>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
