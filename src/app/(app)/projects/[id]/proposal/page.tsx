import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { loadProposal } from "@/lib/proposal/load";
import ProposalView from "./ProposalView";

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { doc, meta, lineCount } = await loadProposal(supabase, id);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className="print-hide">
          <PageHeader
            back={{ href: `/projects/${id}`, label: "Back to project" }}
            title="Proposal"
            subtitle={<>{doc?.project.name ?? "Project"} · the client-ready web proposal</>}
          />
        </div>

        {!meta.exists ? (
          <div className="mt-10 rounded-xl border border-brand/40 bg-brand/10 p-6">
            <p className="text-sm text-foreground">
              One database change is needed first: run{" "}
              <span className="font-medium">0017_phase11_proposals.sql</span> in
              Supabase (SQL Editor → New query → paste → Run), then reload.
            </p>
          </div>
        ) : !doc || lineCount === 0 ? (
          <div className="mt-10 rounded-xl glass p-8 text-center">
            <p className="text-sm text-muted">
              Nothing to propose yet — build the scope and pricing first.
            </p>
          </div>
        ) : (
          <ProposalView projectId={id} doc={doc} meta={meta} />
        )}
      </div>
    </div>
  );
}
