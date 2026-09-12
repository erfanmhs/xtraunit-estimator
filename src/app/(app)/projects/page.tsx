import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { getProjectsOverview, type Stage } from "@/lib/projects/overview";
import type { Project, ProjectStatus } from "@/types";
import ProjectCard from "./ProjectCard";
import ProjectGrid from "./ProjectGrid";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  sent: "Sent",
  won: "Won",
  lost: "Lost",
};

function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted">
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
// AI spend is dollars and cents — a $1.27 run rounds to nothing otherwise.
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const STAGES: { key: keyof ReturnType<typeof stageOrder>; label: string }[] = [
  { key: "plans", label: "Plans" },
  { key: "takeoff", label: "Takeoff" },
  { key: "scope", label: "Scope" },
  { key: "pricing", label: "Pricing" },
  { key: "estimate", label: "Estimate" },
  { key: "proposal", label: "Proposal" },
];
function stageOrder(s: Record<string, Stage>) {
  return s as Record<"plans" | "takeoff" | "scope" | "pricing" | "estimate" | "proposal", Stage>;
}

const DOT: Record<Stage, string> = {
  done: "bg-green-400",
  partial: "bg-amber-400",
  todo: "bg-muted/30",
};

/** Six little dots — the same done / in-progress colors as the rail's stage tabs. */
function StageDots({ stages }: { stages: Record<string, Stage> }) {
  const s = stageOrder(stages);
  const done = STAGES.filter((st) => s[st.key] === "done").length;
  return (
    <div
      className="flex items-center gap-1"
      title={STAGES.map((st) => `${st.label}: ${s[st.key]}`).join(" · ")}
      aria-label={`${done} of ${STAGES.length} stages done`}
    >
      {STAGES.map((st) => (
        <span key={st.key} className={`h-1.5 w-1.5 rounded-full ${DOT[s[st.key]]}`} />
      ))}
      <span className="ml-1 text-[11px] text-muted">
        {done}/{STAGES.length}
      </span>
    </div>
  );
}

export default async function ProjectsPage() {
  const supabase = await createClient();
  // The user's own order first (migration 0039; a project never arranged has
  // no number and goes to the top, which is where a new one belongs), then
  // most recently touched.
  const { data } = await supabase
    .from("projects")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("updated_at", { ascending: false });
  const projects = (data ?? []) as Project[];
  // Migration 0039 adds `archived_at`. Until it is run the column simply is
  // not in the row, and the Archive action stays hidden rather than failing.
  const canArchive = projects.length === 0 || "archived_at" in (data?.[0] ?? {});
  const overview = await getProjectsOverview(
    supabase,
    projects.map((p) => p.id),
  );

  const active = projects.filter((p) => !p.archived_at);
  const archived = projects.filter((p) => !!p.archived_at);

  function card(p: Project) {
    const o = overview[p.id];
    // The most meaningful number we have for this job right now.
    const money = o?.bid
      ? { label: "Bid", value: o.bid }
      : o?.directCost
        ? { label: "Direct cost", value: o.directCost }
        : null;
    return (
      <ProjectCard project={p} canArchive={canArchive}>
        <Link
          href={`/projects/${p.id}`}
          className="flex h-full flex-col gap-3 rounded-xl panel p-5 transition-colors hover:border-brand/60"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 font-medium text-foreground">{p.name}</h2>
            <StatusBadge status={p.status} />
          </div>
          <div className="flex flex-col gap-0.5 text-sm text-muted">
            {p.client_name ? <span className="truncate">{p.client_name}</span> : null}
            {p.address ? <span className="truncate">{p.address}</span> : null}
          </div>
          <div className="mt-auto flex items-end justify-between gap-3 pt-1">
            <div className="flex flex-col gap-1.5">
              {o ? <StageDots stages={o.stages} /> : null}
              <span className="text-xs text-muted/70">
                Updated {new Date(p.updated_at).toLocaleDateString()}
                {o?.aiCostUsd != null ? ` · AI ${usdCents.format(o.aiCostUsd)}` : ""}
              </span>
            </div>
            {money ? (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted">{money.label}</p>
                <p className="font-heading text-lg leading-tight text-foreground">
                  {usd.format(money.value)}
                </p>
              </div>
            ) : null}
          </div>
        </Link>
      </ProjectCard>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        className="border-b border-border px-6 py-5 sm:px-8"
        title="Projects"
        subtitle="Your jobs to bid and estimate."
        action={
          <Link
            href="/projects/new"
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
          >
            + New project
          </Link>
        }
      />

      <div className="p-6 sm:p-8">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20 text-center">
            <p className="font-heading text-xl text-foreground">No projects yet</p>
            <p className="max-w-sm text-sm text-muted">
              Create your first project to start building an estimate from plans
              and takeoffs.
            </p>
            <Link
              href="/projects/new"
              className="mt-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
            >
              + New project
            </Link>
          </div>
        ) : (
          <ProjectGrid
            items={active.map((p) => ({ id: p.id, node: card(p) }))}
            archived={archived.map((p) => ({ id: p.id, node: card(p) }))}
          />
        )}
      </div>
    </div>
  );
}
