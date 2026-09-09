import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import OverflowMenu from "@/components/OverflowMenu";
import DeleteProjectItem from "./DeleteProjectItem";
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
      <PageHeader
        className="border-b border-border px-8 py-5"
        back={{ href: "/projects", label: "All projects" }}
        title={project.name}
        subtitle={
          [project.client_name, project.address, project.project_type]
            .filter(Boolean)
            .join(" · ") || null
        }
        menu={
          <OverflowMenu>
            <DeleteProjectItem id={project.id} name={project.name} />
          </OverflowMenu>
        }
      />

      <div className="flex flex-col gap-6 p-8">
        {project.notes ? (
          <p className="max-w-2xl text-sm text-muted">{project.notes}</p>
        ) : null}

        {/* Phase 2 — live */}
        <PlanManager projectId={project.id} files={files} />

        {/* The four stage cards side by side on a laptop (they also live in the
            rail's stage tabs), stacked on a phone. */}
        <div className="grid gap-4 md:grid-cols-2">
        {/* Phase 7 — live */}
        <Link
          href={`/projects/${project.id}/scope`}
          className="panel flex items-center justify-between gap-4 rounded-xl p-5 transition-colors hover:border-brand/50"
        >
          <div>
            <h2 className="font-heading text-lg text-foreground">Scope of Work</h2>
            <p className="text-sm text-muted">
              AI reads the plans + your takeoff and drafts the scope by CSI division.
            </p>
          </div>
          <span aria-hidden="true" className="text-brand">→</span>
        </Link>

        {/* Phase 9 — live */}
        <Link
          href={`/projects/${project.id}/pricing`}
          className="panel flex items-center justify-between gap-4 rounded-xl p-5 transition-colors hover:border-brand/50"
        >
          <div>
            <h2 className="font-heading text-lg text-foreground">Pricing</h2>
            <p className="text-sm text-muted">
              Direct cost per scope line — labor / material / sub / equipment /
              other, with AI suggestions you confirm.
            </p>
          </div>
          <span aria-hidden="true" className="text-brand">→</span>
        </Link>

        {/* Phase 10 — live */}
        <Link
          href={`/projects/${project.id}/estimate`}
          className="panel flex items-center justify-between gap-4 rounded-xl p-5 transition-colors hover:border-brand/50"
        >
          <div>
            <h2 className="font-heading text-lg text-foreground">Estimate</h2>
            <p className="text-sm text-muted">
              Markups (contingency / insurance / overhead / profit) on the direct
              cost — the bid number, exportable to Excel.
            </p>
          </div>
          <span aria-hidden="true" className="text-brand">→</span>
        </Link>

        {/* Phase 11 — live */}
        <Link
          href={`/projects/${project.id}/proposal`}
          className="panel flex items-center justify-between gap-4 rounded-xl p-5 transition-colors hover:border-brand/50"
        >
          <div>
            <h2 className="font-heading text-lg text-foreground">Proposal</h2>
            <p className="text-sm text-muted">
              The client-ready document — letter on letterhead, CSI cost summary,
              assumptions &amp; exclusions. Print or save as PDF.
            </p>
          </div>
          <span aria-hidden="true" className="text-brand">→</span>
        </Link>
        </div>
      </div>
    </div>
  );
}
