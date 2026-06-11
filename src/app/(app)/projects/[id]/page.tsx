import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteProject } from "../actions";
import PlanManager from "./PlanManager";
import type { PlanFile, Project } from "@/types";


export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const project = data as Project;

  const { data: filesData } = await supabase
    .from("plan_files")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  const files = (filesData ?? []) as PlanFile[];

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-border px-8 py-5">
        <div className="flex flex-col gap-1">
          <Link
            href="/projects"
            className="text-xs text-muted transition-colors hover:text-brand-soft"
          >
            ← All projects
          </Link>
          <h1 className="font-heading text-2xl text-foreground">{project.name}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {project.client_name ? <span>{project.client_name}</span> : null}
            {project.address ? <span>{project.address}</span> : null}
            {project.project_type ? <span>{project.project_type}</span> : null}
          </div>
        </div>
        <form action={deleteProject}>
          <input type="hidden" name="id" value={project.id} />
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand-soft"
          >
            Delete
          </button>
        </form>
      </header>

      <div className="flex flex-col gap-6 p-8">
        {project.notes ? (
          <p className="max-w-2xl text-sm text-muted">{project.notes}</p>
        ) : null}

        {/* Phase 2 — live */}
        <PlanManager projectId={project.id} files={files} />

        {/* Phase 7 — live */}
        <Link
          href={`/projects/${project.id}/scope`}
          className="glass-brand flex items-center justify-between rounded-xl p-5 transition-colors hover:bg-brand/30"
        >
          <div>
            <h2 className="font-heading text-lg text-foreground">Scope of Work</h2>
            <p className="text-sm text-muted">
              AI reads the plans + your takeoff and drafts the scope by CSI division.
            </p>
          </div>
          <span className="text-foreground">→</span>
        </Link>

        {/* Phase 9 — live */}
        <Link
          href={`/projects/${project.id}/pricing`}
          className="glass-brand flex items-center justify-between rounded-xl p-5 transition-colors hover:bg-brand/30"
        >
          <div>
            <h2 className="font-heading text-lg text-foreground">Pricing</h2>
            <p className="text-sm text-muted">
              Direct cost per scope line — labor / material / sub / equipment /
              other, with AI suggestions you confirm.
            </p>
          </div>
          <span className="text-foreground">→</span>
        </Link>

        {/* Phase 10 — live */}
        <Link
          href={`/projects/${project.id}/estimate`}
          className="glass-brand flex items-center justify-between rounded-xl p-5 transition-colors hover:bg-brand/30"
        >
          <div>
            <h2 className="font-heading text-lg text-foreground">Estimate</h2>
            <p className="text-sm text-muted">
              Markups (contingency / insurance / overhead / profit) on the direct
              cost — the bid number, exportable to Excel.
            </p>
          </div>
          <span className="text-foreground">→</span>
        </Link>

        {/* Phase 11 — live */}
        <Link
          href={`/projects/${project.id}/proposal`}
          className="glass-brand flex items-center justify-between rounded-xl p-5 transition-colors hover:bg-brand/30"
        >
          <div>
            <h2 className="font-heading text-lg text-foreground">Proposal</h2>
            <p className="text-sm text-muted">
              The client-ready document — letter on letterhead, CSI cost summary,
              assumptions &amp; exclusions. Print or save as PDF.
            </p>
          </div>
          <span className="text-foreground">→</span>
        </Link>
      </div>
    </div>
  );
}
