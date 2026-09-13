import "server-only";

/**
 * Load everything a project's proposal needs and build the ProposalDoc.
 * Used by the in-app proposal page (live view) and by Publish (the snapshot
 * the share link serves) — one loader, so the two can never disagree.
 *
 * Resilient to older databases: proposals.* is read with select("*") so
 * columns added by migration 0033 simply read as null until it's run.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveProfile } from "./profile";
import { buildProposalDoc, type LineInput, type ProposalDoc } from "./model";

export type ProposalMeta = {
  exists: boolean; // the proposals table exists (migration 0017)
  client_brief: string;
  share_token: string | null;
  published_at: string | null;
  accepted_at: string | null;
  accepted_by: { name?: string; email?: string; at?: string } | null;
  // What's needed to know whether 0033 has been run (share/accept features).
  hasShareColumns: boolean;
};

export async function loadProposal(
  sb: SupabaseClient,
  projectId: string,
): Promise<{ doc: ProposalDoc | null; meta: ProposalMeta; lineCount: number }> {
  const { data: project } = await sb
    .from("projects")
    .select("id,name,client_name,address,project_type,notes")
    .eq("id", projectId)
    .maybeSingle();

  // Resilient to migration 0041 (trade packages) not being run yet.
  const baseCols =
    "id,division_code,division_name,section_code,description,quantity,unit,status,price_mode,cost_labor,cost_material,cost_sub,cost_equipment,cost_other,cost_total,price_status,sort_order";
  const wide = await sb
    .from("line_items")
    .select(`${baseCols},trade_package,deliverable,includes,excludes`)
    .eq("project_id", projectId)
    .order("division_code", { ascending: true })
    .order("sort_order", { ascending: true });
  const { data: items } = wide.error
    ? await sb
        .from("line_items")
        .select(baseCols)
        .eq("project_id", projectId)
        .order("division_code", { ascending: true })
        .order("sort_order", { ascending: true })
    : wide;
  const lines = (items ?? []) as unknown as LineInput[];

  const { data: est } = await sb
    .from("estimates")
    .select("contingency_pct,insurance_pct,overhead_pct,profit_pct,building_sf")
    .eq("project_id", projectId)
    .maybeSingle();
  const { data: cs } = await sb.from("company_settings").select("*").maybeSingle();

  const markups = est
    ? {
        contingency_pct: est.contingency_pct ?? 0,
        insurance_pct: est.insurance_pct ?? 0,
        overhead_pct: (est.overhead_pct ?? 0) + (est.profit_pct ?? 0),
      }
    : {
        contingency_pct: cs?.default_contingency_pct ?? 0,
        insurance_pct: cs?.default_insurance_pct ?? 0,
        overhead_pct: cs?.default_op_pct ?? 0,
      };

  const { data: findings } = await sb
    .from("scope_findings")
    .select("kind,text,resolved")
    .eq("project_id", projectId)
    .in("kind", ["assumption", "exclusion"]);

  const prop = await sb.from("proposals").select("*").eq("project_id", projectId).maybeSingle();
  const row = (prop.data ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : null);

  const meta: ProposalMeta = {
    exists: !prop.error,
    client_brief: str("client_brief") ?? "",
    share_token: str("share_token"),
    published_at: str("published_at"),
    accepted_at: str("accepted_at"),
    accepted_by: (row.accepted_by as ProposalMeta["accepted_by"]) ?? null,
    // No row yet reads as "columns present": the page used to tell a new
    // project that migration 0033 was missing when the proposal simply had
    // not been saved once. The first save is the real test.
    hasShareColumns: !prop.error && (!prop.data || "share_token" in row),
  };

  if (!project) return { doc: null, meta, lineCount: lines.length };

  const doc = buildProposalDoc({
    company: {
      company_name: cs?.company_name ?? null,
      company_address: cs?.company_address ?? null,
      company_phone: cs?.company_phone ?? null,
      company_email: cs?.company_email ?? null,
      company_license: cs?.company_license ?? null,
      signer_name: cs?.signer_name ?? null,
      signer_title: cs?.signer_title ?? null,
    },
    profile: resolveProfile(cs?.proposal_profile),
    project: {
      name: project.name ?? "Project",
      client_name: project.client_name ?? null,
      address: project.address ?? null,
      project_type: project.project_type ?? null,
      building_sf: est?.building_sf ?? null,
    },
    lines,
    markups,
    findings: (findings ?? []).filter((f) => !f.resolved),
    fields: {
      client_name: str("client_name"),
      proposal_date: str("proposal_date"),
      valid_until: str("valid_until"),
      executive_summary: str("executive_summary"),
      project_description: str("project_description"),
      understanding: str("understanding"),
      options: row.options,
      timeline: row.timeline,
      contract: row.contract,
      published_at: str("published_at"),
    },
  });

  return { doc, meta, lineCount: lines.length };
}
