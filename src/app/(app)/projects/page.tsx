import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Project, ProjectStatus } from "@/types";

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

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });
  const projects = (data ?? []) as Project[];

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-8 py-5">
        <div>
          <h1 className="font-heading text-2xl text-foreground">Projects</h1>
          <p className="text-sm text-muted">Your jobs to bid and estimate.</p>
        </div>
        <Link
          href="/projects/new"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
        >
          + New project
        </Link>
      </header>

      <div className="p-8">
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="flex flex-col gap-3 rounded-xl glass p-5 transition-colors hover:border-brand/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium text-foreground">{p.name}</h2>
                  <StatusBadge status={p.status} />
                </div>
                <div className="flex flex-col gap-1 text-sm text-muted">
                  {p.client_name ? <span>{p.client_name}</span> : null}
                  {p.address ? <span className="truncate">{p.address}</span> : null}
                </div>
                <span className="mt-auto text-xs text-muted/70">
                  Updated {new Date(p.updated_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
