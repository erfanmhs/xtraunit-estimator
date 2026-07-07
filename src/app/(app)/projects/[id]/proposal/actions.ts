"use server";

/**
 * Phase 11 — Proposal actions: AI-draft the cover letter, save edits.
 * The letter is the only stored text; cost table + assumptions/exclusions are
 * assembled live so they always match the current estimate.
 */
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient } from "@/lib/anthropic";
import { enforceAiLimit } from "@/lib/ai-usage";

import { AI_MODELS } from "@/config/ai";

const LETTER_MODEL = AI_MODELS.letter;

export async function saveProposal(
  projectId: string,
  patch: {
    letter_text?: string | null;
    client_name?: string | null;
    proposal_date?: string | null;
    project_description?: string | null;
    understanding?: string | null;
    estimated_duration?: string | null;
    anticipated_start?: string | null;
    table_style?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("proposals").upsert(
    {
      project_id: projectId,
      owner_id: user.id,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" },
  );
  if (error)
    return {
      ok: false,
      error:
        "Could not save. (Has migration 0017 been run in Supabase?)",
    };
  return { ok: true };
}

export type ProposalNarrative = {
  opening: string;
  project_description: string;
  understanding: string;
};

/**
 * AI-draft the project-specific narrative — the three parts unique to this bid:
 * the opening, the Project Description, and "Our Understanding of the Project".
 * The standard sections (Who We Are, etc.) come from the company profile and
 * aren't touched here. Returns the text; the user edits/saves it.
 */
export async function draftProposalNarrative(
  projectId: string,
  grandTotal: number,
  divisionSummary: string,
): Promise<{ ok: boolean; narrative?: ProposalNarrative; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const limit = await enforceAiLimit(supabase, user.id, "proposal");
  if (!limit.ok) return { ok: false, error: limit.error };

  const { data: project } = await supabase
    .from("projects")
    .select("name,client_name,address,project_type,notes")
    .eq("id", projectId)
    .maybeSingle();
  const { data: cs } = await supabase
    .from("company_settings")
    .select("company_name,company_license")
    .maybeSingle();

  // Building size sharpens "our understanding"; resilient if 0018 isn't run.
  let buildingSf: number | null = null;
  const est = await supabase
    .from("estimates")
    .select("building_sf")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!est.error) buildingSf = est.data?.building_sf ?? null;

  const usd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const prompt = `Write the project-specific narrative for a construction bid proposal cover letter. Warm but professional — the way a sharp, modern GC writes to an owner they want to work with. No flowery filler, no stacked "we are pleased to submit" clichés, no markdown.

From: ${cs?.company_name ?? "XtraUnit Construction"} (${cs?.company_license ?? "CA LIC #1033830"}), a licensed California general contractor.
To: ${project?.client_name ?? "the Owner"}.
Project: ${project?.name ?? "the project"}${project?.project_type ? ` — ${project.project_type}` : ""} at ${project?.address ?? "the project address"}.${buildingSf ? ` Building size: about ${buildingSf.toLocaleString()} SF.` : ""}
Bid amount: ${usd.format(grandTotal)}.
Trades covered: ${divisionSummary}.
${project?.notes ? `Owner/job notes: ${project.notes}` : ""}

Return JSON with three fields:
- opening: 2-3 sentences. Thank them for the opportunity by project name/address and say you're glad to present this bid. Do NOT restate the dollar amount (a Bid Summary box shows it).
- project_description: 1-2 sentences plainly describing what is being built (e.g. "a new 45-unit, 4-story Type V-A affordable housing building"), using the project type given.
- understanding: one short paragraph (3-5 sentences) titled by us as "Our Understanding of the Project" — show you get the site's real challenges (urban infill, staging constraints, tight MEP coordination, agency compliance like LADBS/LADWP/LAFD and LID stormwater where relevant), and note you reviewed the architectural, structural, and MEP plans. Be specific to this project type, not generic.

No signatures, no addresses, no markdown — body text only.`;

  try {
    const client = getAnthropicClient();
    const stream = client.beta.messages.stream({
      model: LETTER_MODEL,
      max_tokens: 1500,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              opening: { type: "string" },
              project_description: { type: "string" },
              understanding: { type: "string" },
            },
            required: ["opening", "project_description", "understanding"],
          },
        },
      },
      messages: [{ role: "user", content: prompt }],
    });
    const msg = await stream.finalMessage();
    const textBlock = msg.content.find((b) => b.type === "text");
    const text =
      textBlock && "text" in textBlock ? (textBlock.text as string) : "";
    if (!text) return { ok: false, error: "The AI returned nothing — try again." };
    const parsed = JSON.parse(text) as ProposalNarrative;
    return { ok: true, narrative: parsed };
  } catch {
    return { ok: false, error: "Could not draft the letter — try again." };
  }
}
